import { expect, test, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { httpHandler } from '../apps/api/src/http.js';
import { batch } from '../apps/api/src/batch.js';
import { Create } from '../packages/core/src/create.js';
import { Dispatcher } from '../packages/core/src/dispatch.js';
import { Conflict, InvalidCursor, type Appointments } from '../packages/core/src/index.js';
import { event, sqs } from './fixtures.js';

const appointments: Appointments = {
  create: vi.fn(async () => ({
    appointmentId: 'a',
    status: 'pending' as const,
    message: 'accepted',
    createdAt: '2026-10-01T00:00:00Z',
  })),
  list: vi.fn(async () => ({ items: [] })),
  confirm: vi.fn(),
};
const dispatcher = new Dispatcher(
  { claim: vi.fn(), sent: vi.fn(), failed: vi.fn(), due: vi.fn() },
  { publish: vi.fn() },
);
const report = vi.fn();
const handler = httpHandler(new Create(appointments, dispatcher, vi.fn()), appointments, report);

function input(routeKey: string, body?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey,
    rawPath: '/appointments',
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    ...(body ? { body } : {}),
    requestContext: {
      accountId: '',
      apiId: '',
      domainName: '',
      domainPrefix: '',
      requestId: '',
      routeKey,
      stage: '',
      time: '',
      timeEpoch: 0,
      http: {
        method: 'POST',
        path: '/appointments',
        protocol: 'HTTP/1.1',
        sourceIp: '',
        userAgent: '',
      },
    },
  };
}

test('returns acceptance and consistent validation errors', async () => {
  const body = JSON.stringify({ insuredId: '00123', scheduleId: 1, countryISO: 'PE' });
  expect(await handler(input('POST /appointments', body))).toMatchObject({ statusCode: 202 });
  expect(await handler(input('POST /appointments', '{'))).toMatchObject({ statusCode: 400 });
  expect(await handler(input('POST /appointments', '{}'))).toMatchObject({ statusCode: 400 });
  expect(
    await handler({
      ...input('GET /appointments/{insuredId}'),
      pathParameters: { insuredId: '00123' },
    }),
  ).toMatchObject({ statusCode: 200 });
  expect(await handler(input('GET /appointments/{insuredId}'))).toMatchObject({ statusCode: 400 });
  expect(await handler(input('unknown'))).toMatchObject({ statusCode: 404 });
});

test('maps conflicts, invalid cursors and storage failures without exposing details', async () => {
  const post = input(
    'POST /appointments',
    JSON.stringify({ insuredId: '00123', scheduleId: 1, countryISO: 'PE' }),
  );
  vi.mocked(appointments.create).mockRejectedValueOnce(new Conflict('secret detail'));
  expect(await handler(post)).toMatchObject({ statusCode: 409 });
  vi.mocked(appointments.create).mockRejectedValueOnce(new Error('secret detail'));
  const result = await handler(post);
  expect(result).toMatchObject({ statusCode: 503 });
  expect(JSON.stringify(result)).not.toContain('secret detail');
  vi.mocked(appointments.list).mockRejectedValueOnce(new InvalidCursor());
  expect(
    await handler({
      ...input('GET /appointments/{insuredId}'),
      pathParameters: { insuredId: '00123' },
    }),
  ).toMatchObject({ statusCode: 400 });
});

test('reports only failed SQS records', async () => {
  const result = await batch(
    {
      Records: [
        {
          messageId: 'bad',
          body: '{}',
          receiptHandle: '',
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '0',
            SenderId: '',
            ApproximateFirstReceiveTimestamp: '0',
          },
          messageAttributes: {},
          md5OfBody: '',
          eventSource: 'aws:sqs',
          eventSourceARN: '',
          awsRegion: 'us-east-1',
        },
      ],
    },
    vi.fn(),
    vi.fn(),
  );
  expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'bad' }] });
});

test('handles encoded bodies, missing bodies, size limits and optional headers', async () => {
  const valid = JSON.stringify({ insuredId: '00123', scheduleId: 1, countryISO: 'PE' });
  const encoded = {
    ...input('POST /appointments', Buffer.from(valid).toString('base64')),
    isBase64Encoded: true,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'valid-key' },
  };
  expect(await handler(encoded)).toMatchObject({ statusCode: 202 });
  expect(appointments.create).toHaveBeenLastCalledWith(JSON.parse(valid), 'valid-key');
  expect(await handler({ ...encoded, headers: { 'idempotency-key': 'bad key' } })).toMatchObject({
    statusCode: 400,
  });
  expect(await handler(input('POST /appointments'))).toMatchObject({ statusCode: 400 });
  expect(await handler({ ...input('POST /appointments'), isBase64Encoded: true })).toMatchObject({
    statusCode: 400,
  });
  expect(await handler(input('POST /appointments', 'x'.repeat(4097)))).toMatchObject({
    statusCode: 413,
  });
  expect(
    await handler({
      ...input('GET /appointments/{insuredId}'),
      pathParameters: { insuredId: '00123' },
      queryStringParameters: { limit: '101' },
    }),
  ).toMatchObject({ statusCode: 400 });
  vi.mocked(appointments.create).mockRejectedValueOnce('non-error rejection');
  expect(await handler(input('POST /appointments', valid))).toMatchObject({ statusCode: 503 });
  expect(report).toHaveBeenLastCalledWith('UnknownError');
});

test('continues a mixed SQS batch after unknown failures', async () => {
  const action = vi.fn().mockRejectedValueOnce('unknown').mockResolvedValueOnce(undefined);
  const reportBatch = vi.fn();
  expect(await batch(sqs(event, event), action, reportBatch)).toEqual({
    batchItemFailures: [{ itemIdentifier: 'message-0' }],
  });
  expect(action).toHaveBeenCalledTimes(2);
  expect(reportBatch).toHaveBeenCalledWith('message-0', 'UnknownError');
});
