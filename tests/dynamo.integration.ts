import { beforeAll, afterAll, expect, test } from 'vitest';
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoAppointments } from '../packages/adapters/src/dynamo.js';

const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const suffix = Date.now();
const tables = {
  appointments: `appointments-${suffix}`,
  keys: `keys-${suffix}`,
  outbox: `outbox-${suffix}`,
};
const store = new DynamoAppointments(DynamoDBDocumentClient.from(client), tables);
const input = { insuredId: '00123', countryISO: 'PE' as const, scheduleId: 123 };

beforeAll(async () => {
  for (const [name, TableName] of Object.entries(tables)) {
    const attributes = name === 'appointments' ? ['insuredId', 'appointmentId'] : ['id'];
    await client.send(
      new CreateTableCommand({
        TableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: attributes.map((AttributeName) => ({
          AttributeName,
          AttributeType: 'S',
        })),
        KeySchema: attributes.map((AttributeName, index) => ({
          AttributeName,
          KeyType: index === 0 ? 'HASH' : 'RANGE',
        })),
      }),
    );
  }
});
afterAll(async () => {
  for (const TableName of Object.values(tables))
    await client.send(new DeleteTableCommand({ TableName }));
  client.destroy();
});

test('concurrent requests and different keys create exactly one appointment', async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => store.create(input, `key-${i % 4}`)),
  );
  expect(new Set(results.map((result) => result.appointmentId)).size).toBe(1);
  expect(new Set(results.map((result) => result.createdAt)).size).toBe(1);
  expect((await store.list('00123', 20)).items).toHaveLength(1);
  await expect(store.create({ ...input, scheduleId: 124 }, 'key-0')).rejects.toThrow(
    'already used',
  );
  expect(await store.create(input)).toEqual(results[0]);
});

test('logical TTL allows reuse without expiring business uniqueness', async () => {
  const future = new DynamoAppointments(
    DynamoDBDocumentClient.from(client),
    tables,
    () => Date.now() + 86401000,
  );
  const initial = await store.create({ ...input, insuredId: '00222' }, 'expiring');
  const reused = await future.create({ ...input, insuredId: '00333' }, 'expiring');
  expect(reused.appointmentId).not.toBe(initial.appointmentId);
  expect((await future.create({ ...input, insuredId: '00222' })).appointmentId).toBe(
    initial.appointmentId,
  );
});

test('paginates, rejects cross-insured cursors, and returns empty lists', async () => {
  await store.create({ ...input, scheduleId: 125 });
  const first = await store.list('00123', 1);
  expect(first.items).toHaveLength(1);
  expect(first.cursor).toBeDefined();
  const next = await store.list('00123', 1, first.cursor);
  expect(next.items[0]?.appointmentId).not.toBe(first.items[0]?.appointmentId);
  await expect(store.list('99999', 1, first.cursor)).rejects.toThrow('Invalid pagination');
  await expect(store.list('00123', 1, 'bad')).rejects.toThrow('Invalid pagination');
  expect((await store.list('99999', 20)).items).toEqual([]);
});

test('confirmation is idempotent and never creates orphan records', async () => {
  const accepted = await store.create({ ...input, scheduleId: 126 });
  const confirmation = {
    ...input,
    scheduleId: 126,
    version: 1 as const,
    type: 'appointment.completed' as const,
    eventId: accepted.appointmentId,
    appointmentId: accepted.appointmentId,
    correlationId: accepted.appointmentId,
    occurredAt: accepted.createdAt,
  };
  await store.confirm(confirmation);
  await store.confirm(confirmation);
  const current = (await store.list('00123', 20)).items.find(
    (item) => item.appointmentId === accepted.appointmentId,
  );
  expect(current?.status).toBe('completed');
  expect((await store.create({ ...input, scheduleId: 126 })).status).toBe('pending');
  await expect(store.confirm({ ...confirmation, countryISO: 'CL' })).rejects.toThrow();
  await expect(store.confirm({ ...confirmation, insuredId: '99999' })).rejects.toThrow();
});
