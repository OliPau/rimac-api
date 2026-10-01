import { afterEach, expect, test, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoAppointments } from '../packages/adapters/src/dynamo.js';
import { event } from './fixtures.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const mock = mockClient(client);
const store = new DynamoAppointments(client, {
  appointments: 'appointments',
  keys: 'keys',
  outbox: 'outbox',
});
afterEach(() => {
  mock.reset();
  vi.useRealTimers();
});

test('bounds transaction conflicts and does not retry unrelated failures', async () => {
  vi.useFakeTimers();
  mock.on(GetCommand).resolves({});
  mock
    .on(TransactWriteCommand)
    .rejects(Object.assign(new Error('conflict'), { name: 'TransactionCanceledException' }));
  const failure = expect(store.create(event)).rejects.toThrow('conflict');
  await vi.runAllTimersAsync();
  await failure;
  expect(mock.commandCalls(TransactWriteCommand)).toHaveLength(8);
  mock.on(TransactWriteCommand).rejects(new Error('unavailable'));
  await expect(store.create(event)).rejects.toThrow('unavailable');
  mock
    .on(TransactWriteCommand)
    .callsFake(vi.fn<() => Promise<never>>().mockRejectedValue('unknown'));
  await expect(store.create(event)).rejects.toBe('unknown');
});

test('returns an empty page for omitted DynamoDB items and rejects wrong confirmation types', async () => {
  mock.on(QueryCommand).resolves({});
  expect(await store.list('00123', 20)).toEqual({ items: [] });
  await expect(store.confirm(event)).rejects.toThrow('Unexpected confirmation type');
});
