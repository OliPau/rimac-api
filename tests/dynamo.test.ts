import { afterEach, expect, test, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoAppointments } from '#infrastructure/persistence/dynamo/repository';
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

test('returns an empty page for omitted DynamoDB items', async () => {
  mock.on(QueryCommand).resolves({});
  expect(await store.list('00123', 20)).toEqual({ items: [] });
});

test.each(['ValidationError', 'ItemCollectionSizeLimitExceeded', 'UnknownPermanentCode'])(
  'does not retry permanent cancellation %s even alongside a conflict',
  async (Code) => {
    mock.on(GetCommand).resolves({});
    const cause = Object.assign(new Error('permanent'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'TransactionConflict' }, { Code }],
    });
    mock.on(TransactWriteCommand).rejects(cause);
    await expect(store.create(event)).rejects.toBe(cause);
    expect(mock.commandCalls(TransactWriteCommand)).toHaveLength(1);
  },
);

test.each([
  'None',
  'ConditionalCheckFailed',
  'TransactionConflict',
  'ProvisionedThroughputExceeded',
  'ThrottlingError',
  undefined,
])('retries recoverable or unspecified cancellation %s', async (Code) => {
  mock.on(GetCommand).resolves({});
  mock
    .on(TransactWriteCommand)
    .rejectsOnce(
      Object.assign(new Error('temporary'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code }],
      }),
    )
    .resolves({});
  await expect(store.create(event)).resolves.toMatchObject({ status: 'pending' });
  expect(mock.commandCalls(TransactWriteCommand)).toHaveLength(2);
});
