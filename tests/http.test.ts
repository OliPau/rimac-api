import { expect, test, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { httpHandler } from '../apps/api/src/http.js';
import { batch } from '../apps/api/src/batch.js';
import { Create, Dispatcher } from '../packages/core/src/create.js';
import { Conflict, InvalidCursor, type Appointments } from '../packages/core/src/index.js';

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
