import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { Logger } from '@aws-lambda-powertools/logger';
import { context, event, http, sqs } from './fixtures.js';
import { identity } from '#domain/appointments/index';
import { cursorMessage } from '#infrastructure/http/dto/appointment.dto';

const dynamo = mockClient(DynamoDBDocumentClient);
const sns = mockClient(SNSClient);
const input = JSON.stringify({ insuredId: '00123', scheduleId: 123, countryISO: 'PE' });

beforeEach(() => {
  vi.resetModules();
  for (const key of ['APPOINTMENTS_TABLE', 'KEYS_TABLE', 'OUTBOX_TABLE', 'TOPIC_ARN']) {
    vi.stubEnv(key, key);
  }
  dynamo.on(GetCommand).resolves({});
  dynamo.on(TransactWriteCommand).resolves({});
  dynamo.on(UpdateCommand).resolves({ Attributes: { event, attempts: 1 } });
  sns.on(PublishCommand).resolves({ MessageId: 'receipt' });
  vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  dynamo.reset();
  sns.reset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('composes the HTTP entrypoint with durable persistence and SNS publication', async () => {
  const { handler } = await import('../src/handlers/appointment.js');
  expect(await handler(http('POST /appointments', input), context)).toMatchObject({
    statusCode: 202,
  });
  expect(
    sns.commandCalls(PublishCommand)[0]?.args[0].input.MessageAttributes?.countryISO?.StringValue,
  ).toBe('PE');
  expect(dynamo.commandCalls(TransactWriteCommand)).toHaveLength(1);
});

test('keeps acceptance when immediate dispatch fails and logs the failure', async () => {
  dynamo.on(UpdateCommand).rejects(new Error('unavailable'));
  const { handler } = await import('../src/handlers/appointment.js');
  expect(await handler(http('POST /appointments', input), context)).toMatchObject({
    statusCode: 202,
  });
  expect(Logger.prototype.error).toHaveBeenCalledWith(
    'PublicationFailed',
    expect.objectContaining({ phase: 'claim', errorName: 'Error' }),
  );
  dynamo.on(GetCommand).rejects(new Error('unavailable'));
  expect(await handler(http('POST /appointments', input), context)).toMatchObject({
    statusCode: 503,
  });
  expect(Logger.prototype.error).toHaveBeenCalledWith('RequestFailed', { errorName: 'Error' });
});

test('logs immediate SNS and rescheduling failures while retaining durable acceptance', async () => {
  const appointmentId = identity({
    insuredId: '00123',
    scheduleId: 123,
    countryISO: 'PE',
  }).appointmentId;
  const publishCause = Object.assign(new Error('private publisher details'), {
    name: 'PublishFailure',
  });
  sns.on(PublishCommand).rejects(publishCause);
  dynamo
    .on(UpdateCommand)
    .resolvesOnce({ Attributes: { event: { ...event, appointmentId }, attempts: 1 } })
    .rejects(Object.assign(new Error('private storage details'), { name: 'RescheduleFailure' }));
  const { handler } = await import('../src/handlers/appointment.js');
  expect(await handler(http('POST /appointments', input), context)).toMatchObject({
    statusCode: 202,
  });
  expect(Logger.prototype.error).toHaveBeenCalledWith(
    'PublicationFailed',
    expect.objectContaining({
      phase: 'publish',
      errorName: 'PublishFailure',
      recoveryPhase: 'reschedule',
      recoveryErrorName: 'RescheduleFailure',
      correlationId: event.correlationId,
    }),
  );
  expect(JSON.stringify(vi.mocked(Logger.prototype.error).mock.calls)).not.toContain('private');
});

test('confirms SQS messages and reports only failed records', async () => {
  const { handler } = await import('../src/handlers/appointment.js');
  expect(await handler(sqs({ ...event, type: 'appointment.completed' }, event), context)).toEqual({
    batchItemFailures: [{ itemIdentifier: 'message-1' }],
  });
  expect(Logger.prototype.info).toHaveBeenCalledWith(
    'AppointmentCompleted',
    expect.objectContaining({ appointmentId: event.appointmentId }),
  );
  expect(Logger.prototype.error).toHaveBeenCalledWith('ConfirmationFailed', {
    messageId: 'message-1',
    errorName: 'Error',
  });
});

test('scheduled entrypoint recovers due messages and emits pending age', async () => {
  dynamo
    .on(QueryCommand)
    .resolvesOnce({ Items: [{ id: event.appointmentId }] })
    .resolves({ Items: [] });
  const { handler } = await import('../src/handlers/retry.js');
  await handler();
  expect(sns.commandCalls(PublishCommand)).toHaveLength(1);
  expect(Logger.prototype.info).toHaveBeenCalledWith('OutboxRetry', {
    attempted: 1,
    sent: 1,
    skipped: 0,
    failed: 0,
    pendingAge: 0,
  });
});

test('rejects missing runtime configuration', async () => {
  vi.stubEnv('APPOINTMENTS_TABLE', '');
  await expect(import('../src/composition/dynamo.js')).rejects.toThrow(
    'Missing configuration: APPOINTMENTS_TABLE',
  );
});

test.each([
  '',
  '!',
  'x'.repeat(2049),
  Buffer.from(JSON.stringify({ insuredId: '00123', appointmentId: '-'.repeat(36) })).toString(
    'base64url',
  ),
])('returns INVALID_CURSOR at the actual HTTP boundary for %s', async (cursor) => {
  const { handler } = await import('../src/handlers/appointment.js');
  const result = await handler(
    {
      ...http('GET /appointments/{insuredId}'),
      pathParameters: { insuredId: '00123' },
      queryStringParameters: { cursor },
    },
    context,
  );
  expect(result).toMatchObject({
    statusCode: 400,
    body: JSON.stringify({
      error: { code: 'INVALID_CURSOR', details: [{ field: 'cursor', message: cursorMessage }] },
    }),
  });
  expect(dynamo.commandCalls(QueryCommand)).toHaveLength(0);
});
