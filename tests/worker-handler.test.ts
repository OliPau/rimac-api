import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  RDSDataClient,
  BeginTransactionCommand,
  ExecuteStatementCommand,
  CommitTransactionCommand,
} from '@aws-sdk/client-rds-data';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { context, event, sqs } from './fixtures.js';

const rds = mockClient(RDSDataClient);
const bridge = mockClient(EventBridgeClient);
beforeEach(() => {
  vi.resetModules();
  for (const key of ['CLUSTER_ARN', 'SECRET_ARN', 'DATABASE', 'EVENT_BUS']) {
    vi.stubEnv(key, key);
  }
  vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  rds.reset();
  bridge.reset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test.each(['PE', 'CL'] as const)(
  'composes the %s worker with its SQL transaction and confirmation',
  async (countryISO) => {
    vi.stubEnv('COUNTRY', countryISO);
    const confirmation = { ...event, countryISO, type: 'appointment.completed' };
    rds.on(BeginTransactionCommand).resolves({ transactionId: 'transaction' });
    rds.on(CommitTransactionCommand).resolves({});
    rds.on(ExecuteStatementCommand).callsFake((input: { sql: string }) => {
      if (input.sql.startsWith('SELECT insured')) {
        return {
          columnMetadata: [
            { name: 'insured_id' },
            { name: 'schedule_id' },
            { name: 'country_iso' },
          ],
          records: [
            [
              { stringValue: event.insuredId },
              { longValue: event.scheduleId },
              { stringValue: countryISO },
            ],
          ],
        };
      }
      if (input.sql.startsWith('SELECT payload')) {
        return {
          columnMetadata: [{ name: 'payload' }, { name: 'published' }],
          records: [[{ stringValue: JSON.stringify(confirmation) }, { longValue: 0 }]],
        };
      }
      return {};
    });
    bridge
      .on(PutEventsCommand)
      .resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'receipt' }] });
    const { handler } = await import('../apps/api/src/worker.js');
    expect(await handler(sqs({ ...event, countryISO }), context)).toEqual({
      batchItemFailures: [],
    });
    expect(rds.commandCalls(CommitTransactionCommand)).toHaveLength(1);
    const detail = bridge.commandCalls(PutEventsCommand)[0]?.args[0].input.Entries?.[0]?.Detail;
    expect(JSON.parse(detail ?? '{}')).toEqual(confirmation);
    bridge.on(PutEventsCommand).rejects(new Error('unavailable'));
    expect(await handler(sqs({ ...event, countryISO }), context)).toEqual({
      batchItemFailures: [{ itemIdentifier: 'message-0' }],
    });
    expect(Logger.prototype.error).toHaveBeenCalledWith('CountryFailed', {
      messageId: 'message-0',
      errorName: 'Error',
      country: countryISO,
    });
  },
);

test('rejects unsupported worker countries before consuming messages', async () => {
  vi.stubEnv('COUNTRY', 'AR');
  await expect(import('../apps/api/src/worker.js')).rejects.toThrow('Invalid worker country');
});
