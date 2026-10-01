import {
  RDSDataClient,
  RollbackTransactionCommand,
  CommitTransactionCommand,
  BeginTransactionCommand,
  ExecuteStatementCommand,
} from '@aws-sdk/client-rds-data';
import { expect, test, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DataApi } from '../packages/adapters/src/data-api.js';

function setup() {
  const client = new RDSDataClient({ region: 'us-east-1' });
  const send = mockClient(client);
  const database = new DataApi(client, {
    resourceArn: 'cluster',
    secretArn: 'secret',
    database: 'appointments_pe',
  });
  return { client, send, database };
}

test('maps prepared statement fields and commits successful transactions', async () => {
  const { database, send, client } = setup();
  send.on(BeginTransactionCommand).resolves({ transactionId: 'transaction' });
  send.on(ExecuteStatementCommand).resolves({
    columnMetadata: [{ name: '', label: 'total' }],
    records: [[{ longValue: 1 }]],
  });
  send.on(CommitTransactionCommand).resolves({});
  const rows = await database.transaction((sql) => sql.execute('SELECT :n AS total', { n: 1 }));
  expect(rows).toEqual([{ total: 1 }]);
  expect(send.commandCalls(CommitTransactionCommand)).toHaveLength(1);
  send.restore();
  client.destroy();
});

test('rolls back failed work without hiding the original error', async () => {
  const { database, send, client } = setup();
  send.on(BeginTransactionCommand).resolves({ transactionId: 'transaction' });
  send.on(RollbackTransactionCommand).rejects(new Error('transaction already expired'));
  await expect(
    database.transaction(() => Promise.reject(new Error('original failure'))),
  ).rejects.toThrow('original failure');
  expect(send.commandCalls(RollbackTransactionCommand)).toHaveLength(1);
  send.restore();
  client.destroy();
});

test.each(['DatabaseResumingException', 'ThrottlingException', 'TooManyRequestsException'])(
  'retries transient Data API response %s with bounded backoff',
  async (name) => {
    vi.useFakeTimers();
    const { database, send, client } = setup();
    send
      .on(ExecuteStatementCommand)
      .rejectsOnce(Object.assign(new Error('temporarily unavailable'), { name }))
      .resolves({ records: [] });
    const pending = database.execute('SELECT 1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual([]);
    expect(send.calls()).toHaveLength(2);
    send.restore();
    client.destroy();
    vi.useRealTimers();
  },
);

test('maps nullable and scalar fields and rejects incomplete metadata', async () => {
  const { database, send, client } = setup();
  send
    .on(ExecuteStatementCommand)
    .resolvesOnce({})
    .resolvesOnce({
      columnMetadata: ['text', 'number', 'flag', 'empty'].map((name) => ({ name })),
      records: [
        [{ stringValue: 'value' }, { longValue: 0 }, { booleanValue: false }, { isNull: true }],
      ],
    })
    .resolvesOnce({ records: [[{ longValue: 1 }]] })
    .resolvesOnce({ columnMetadata: [{}], records: [[{ longValue: 1 }]] });
  expect(await database.execute('SELECT 1')).toEqual([]);
  expect(await database.execute('SELECT :value', { value: 'text' })).toEqual([
    { text: 'value', number: 0, flag: false, empty: null },
  ]);
  await expect(database.execute('SELECT 1')).rejects.toThrow('Missing SQL column metadata');
  await expect(database.execute('SELECT 1')).rejects.toThrow('Missing SQL column metadata');
  expect(send.commandCalls(ExecuteStatementCommand)[1]?.args[0].input.parameters).toEqual([
    { name: 'value', value: { stringValue: 'text' } },
  ]);
  send.restore();
  client.destroy();
});

test('requires a transaction identifier and rolls back before propagating failure', async () => {
  const { database, send, client } = setup();
  send.on(BeginTransactionCommand).resolvesOnce({}).resolves({ transactionId: 'transaction' });
  await expect(database.transaction((sql) => sql.execute('SELECT 1'))).rejects.toThrow(
    'Missing SQL transaction',
  );
  send.on(ExecuteStatementCommand).rejects(new Error('query failed'));
  send.on(RollbackTransactionCommand).resolves({});
  await expect(database.transaction((sql) => sql.execute('SELECT 1'))).rejects.toThrow(
    'query failed',
  );
  expect(send.commandCalls(RollbackTransactionCommand)).toHaveLength(1);
  send.restore();
  client.destroy();
});

test('bounds persistent transient failures and preserves unknown rejections', async () => {
  vi.useFakeTimers();
  const { database, send, client } = setup();
  try {
    send
      .on(ExecuteStatementCommand)
      .rejects(Object.assign(new Error('offline'), { name: 'DatabaseUnavailableException' }));
    const failure = expect(database.execute('SELECT 1')).rejects.toThrow('offline');
    await vi.runAllTimersAsync();
    await failure;
    expect(send.commandCalls(ExecuteStatementCommand)).toHaveLength(5);
    send
      .on(ExecuteStatementCommand)
      .callsFake(vi.fn<() => Promise<never>>().mockRejectedValue('unknown'));
    await expect(database.execute('SELECT 1')).rejects.toBe('unknown');
  } finally {
    send.restore();
    client.destroy();
    vi.useRealTimers();
  }
});
