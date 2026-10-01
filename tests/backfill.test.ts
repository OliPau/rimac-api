import { afterEach, expect, test } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { backfillPending } from '../scripts/backfill.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const mock = mockClient(client);
const event = {
  version: 1,
  type: 'appointment.requested',
  insuredId: '00123',
  scheduleId: 1,
  countryISO: 'PE',
  appointmentId: '10000000-0000-4000-8000-000000000001',
  eventId: '10000000-0000-4000-8000-000000000002',
  correlationId: '10000000-0000-4000-8000-000000000003',
  occurredAt: '2026-10-01T00:00:00.000Z',
};
afterEach(() => mock.reset());

test('paginates future retries and skips migrated or concurrently published records', async () => {
  mock
    .on(QueryCommand)
    .resolvesOnce({
      Items: [
        { id: 'old', event },
        { id: 'migrated', pendingSince: 1 },
      ],
      LastEvaluatedKey: { id: 'old' },
    })
    .resolvesOnce({ Items: [{ id: 'published', event }] });
  mock
    .on(UpdateCommand)
    .resolvesOnce({})
    .rejectsOnce(Object.assign(new Error(), { name: 'ConditionalCheckFailedException' }));
  expect(await backfillPending(client, 'outbox')).toBe(1);
  expect(mock.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey).toEqual({
    id: 'old',
  });
  expect(mock.commandCalls(UpdateCommand)[0]?.args[0].input).toMatchObject({
    ConditionExpression: '#state = :pending AND attribute_not_exists(pendingSince)',
    ExpressionAttributeValues: { ':since': Date.parse(event.occurredAt) },
  });
  mock.reset();
  mock.on(QueryCommand).resolves({});
  expect(await backfillPending(client, 'outbox')).toBe(0);
});

test('fails visibly on malformed legacy data or storage failures', async () => {
  mock.on(QueryCommand).resolves({ Items: [{ event }] });
  await expect(backfillPending(client, 'outbox')).rejects.toThrow('Invalid outbox');
  mock.on(QueryCommand).resolves({ Items: [{ id: 'old', event: {} }] });
  await expect(backfillPending(client, 'outbox')).rejects.toThrow();
  mock.on(QueryCommand).resolves({ Items: [{ id: 'old', event }] });
  mock.on(UpdateCommand).rejects(new Error('storage failure'));
  await expect(backfillPending(client, 'outbox')).rejects.toThrow('storage failure');
});
