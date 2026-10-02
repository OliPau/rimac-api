import { backfillPending } from '../scripts/backfill.js';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoAppointments } from '#infrastructure/persistence/dynamo/repository';
import { DynamoOutbox } from '#infrastructure/persistence/dynamo/outbox';

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
        AttributeDefinitions: [
          ...attributes.map((AttributeName) => ({
            AttributeName,
            AttributeType: 'S' as const,
          })),
          ...(name === 'outbox'
            ? [
                { AttributeName: 'state', AttributeType: 'S' as const },
                { AttributeName: 'dueAt', AttributeType: 'N' as const },
                { AttributeName: 'pendingSince', AttributeType: 'N' as const },
              ]
            : []),
        ],
        ...(name === 'outbox'
          ? {
              GlobalSecondaryIndexes: [
                {
                  IndexName: 'pending-age',
                  Projection: { ProjectionType: 'KEYS_ONLY' },
                  KeySchema: [
                    { AttributeName: 'state', KeyType: 'HASH' },
                    { AttributeName: 'pendingSince', KeyType: 'RANGE' },
                  ],
                },
                {
                  IndexName: 'due',
                  Projection: { ProjectionType: 'ALL' },
                  KeySchema: [
                    { AttributeName: 'state', KeyType: 'HASH' },
                    { AttributeName: 'dueAt', KeyType: 'RANGE' },
                  ],
                },
              ],
            }
          : {}),
        KeySchema: attributes.map((AttributeName, index) => ({
          AttributeName,
          KeyType: index === 0 ? 'HASH' : 'RANGE',
        })),
      }),
    );
  }
});

test('leases pending publications and recovers abandoned or failed claims', async () => {
  const accepted = await store.create({ ...input, insuredId: '00444' });
  let clock = Date.now();
  const outbox = new DynamoOutbox(DynamoDBDocumentClient.from(client), tables.outbox, () => clock);
  const second = new DynamoOutbox(DynamoDBDocumentClient.from(client), tables.outbox, () => clock);
  const claimed = await outbox.claim(accepted.appointmentId);
  expect(claimed).toBeDefined();
  expect(await second.claim(accepted.appointmentId)).toBeUndefined();
  clock += 61000;
  const recovered = await second.claim(accepted.appointmentId);
  if (!claimed || !recovered) {
    throw new Error('Missing claimed event');
  }
  await expect(outbox.sent(claimed)).rejects.toThrow();
  await second.failed(recovered);
  clock += 100000;
  expect(await second.due(25)).toContain(accepted.appointmentId);
  const retry = await second.claim(accepted.appointmentId);
  if (!retry) {
    throw new Error('Missing retry event');
  }
  await second.sent(retry);
  expect(await outbox.claim(accepted.appointmentId)).toBeUndefined();
});
afterAll(async () => {
  for (const TableName of Object.values(tables)) {
    await client.send(new DeleteTableCommand({ TableName }));
  }
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

test('does not leave an appointment or key when the outbox transaction fails', async () => {
  const broken = new DynamoAppointments(DynamoDBDocumentClient.from(client), {
    ...tables,
    outbox: `missing-outbox-${suffix}`,
  });
  const request = { ...input, insuredId: '00888' };
  await expect(broken.create(request, 'atomic-failure')).rejects.toThrow();
  expect((await store.list(request.insuredId, 20)).items).toEqual([]);
  const changed = { ...request, scheduleId: request.scheduleId + 1 };
  await expect(store.create(changed, 'atomic-failure')).resolves.toMatchObject({
    status: 'pending',
  });
  expect((await store.list(request.insuredId, 20)).items).toHaveLength(1);
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

test('keeps original pending age through leases, backoff and legacy migration', async () => {
  const documents = DynamoDBDocumentClient.from(client);
  const clock = Date.now() + 100000;
  const oldStore = new DynamoAppointments(documents, tables, () => clock - 600000);
  const newStore = new DynamoAppointments(documents, tables, () => clock - 30000);
  const old = await oldStore.create({ ...input, insuredId: '00666' });
  await newStore.create({ ...input, insuredId: '00667' });
  const outbox = new DynamoOutbox(documents, tables.outbox, () => clock);
  const claimed = await outbox.claim(old.appointmentId);
  expect(claimed).toBeDefined();
  await documents.send(
    new UpdateCommand({
      TableName: tables.outbox,
      Key: { id: old.appointmentId },
      UpdateExpression: 'REMOVE pendingSince',
    }),
  );
  expect(await backfillPending(documents, tables.outbox)).toBe(1);
  expect(await backfillPending(documents, tables.outbox)).toBe(0);
  expect(await outbox.pendingAge()).toBe(600);
  if (!claimed) {
    throw new Error('Missing event');
  }
  await outbox.failed(claimed);
  expect(await outbox.pendingAge()).toBe(600);
  const future = new DynamoOutbox(documents, tables.outbox, () => clock + 1000000);
  const recovered = await future.claim(old.appointmentId);
  if (!recovered) {
    throw new Error('Missing recovered event');
  }
  await future.sent(recovered);
  const row = await documents.send(
    new GetCommand({ TableName: tables.outbox, Key: { id: old.appointmentId } }),
  );
  expect(row.Item?.pendingSince).toBeUndefined();
  expect(await outbox.pendingAge()).toBeLessThan(600);
});
