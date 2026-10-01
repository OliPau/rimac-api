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

test('retries Aurora resume responses with bounded backoff', async () => {
  vi.useFakeTimers();
  const { database, send, client } = setup();
  send
    .on(ExecuteStatementCommand)
    .rejectsOnce(Object.assign(new Error('resuming'), { name: 'DatabaseResumingException' }))
    .resolves({ records: [] });
  const pending = database.execute('SELECT 1');
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toEqual([]);
  expect(send.calls()).toHaveLength(2);
  send.restore();
  client.destroy();
  vi.useRealTimers();
});
