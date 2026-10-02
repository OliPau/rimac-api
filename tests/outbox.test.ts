import { afterEach, expect, test, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoOutbox } from '#infrastructure/persistence/dynamo/outbox';
import { event } from './fixtures.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const mock = mockClient(client);
const now = Date.parse(event.occurredAt) + 600000;
afterEach(() => mock.reset());

test('propagates storage and malformed record failures without inventing a lease', async () => {
  const outbox = new DynamoOutbox(client, 'outbox');
  mock.on(UpdateCommand).rejects(new Error('offline'));
  await expect(outbox.claim('id')).rejects.toThrow('offline');
  mock.on(UpdateCommand).callsFake(vi.fn<() => Promise<never>>().mockRejectedValue('unknown'));
  await expect(outbox.claim('id')).rejects.toBe('unknown');
  mock.on(UpdateCommand).resolves({});
  await expect(outbox.claim('id')).rejects.toThrow();
  await expect(outbox.sent(event)).rejects.toThrow('Missing outbox lease');
  mock
    .on(QueryCommand)
    .resolvesOnce({})
    .resolvesOnce({ Items: [{}] });
  expect(await outbox.due(25)).toEqual([]);
  await expect(outbox.due(25)).rejects.toThrow('Invalid outbox identifier');
});

test('clears local leases even if releasing them fails', async () => {
  const outbox = new DynamoOutbox(client, 'outbox');
  mock
    .on(UpdateCommand)
    .resolvesOnce({ Attributes: { event, attempts: 1 } })
    .rejects(new Error('lost lease'));
  await outbox.claim(event.appointmentId);
  await expect(outbox.sent(event)).rejects.toThrow('lost lease');
  await expect(outbox.sent(event)).rejects.toThrow('Missing outbox lease');
});

test('reads immutable pending age and handles empty or invalid results', async () => {
  const outbox = new DynamoOutbox(client, 'outbox', () => now);
  mock
    .on(QueryCommand)
    .resolvesOnce({})
    .resolvesOnce({ Items: [] })
    .resolvesOnce({ Items: [{ pendingSince: now - 600000 }] })
    .resolvesOnce({ Items: [{ pendingSince: now + 1000 }] })
    .resolvesOnce({ Items: [{ pendingSince: 'invalid' }] })
    .resolvesOnce({ Items: [{ pendingSince: NaN }] });
  expect(await outbox.oldestPendingAge()).toBe(0);
  expect(await outbox.oldestPendingAge()).toBe(0);
  expect(await outbox.oldestPendingAge()).toBe(600);
  expect(await outbox.oldestPendingAge()).toBe(0);
  await expect(outbox.oldestPendingAge()).rejects.toThrow('Invalid pending publication timestamp');
  await expect(outbox.oldestPendingAge()).rejects.toThrow('Invalid pending publication timestamp');
  expect(mock.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
    IndexName: 'pending-age',
    Limit: 1,
  });
});

test('supports the previous metric during the staged migration', async () => {
  const outbox = new DynamoOutbox(client, 'outbox', () => now);
  mock
    .on(QueryCommand)
    .resolvesOnce({})
    .resolvesOnce({ Items: [{ event }] });
  expect(await outbox.pendingAge()).toBe(0);
  expect(await outbox.pendingAge()).toBe(600);
});
