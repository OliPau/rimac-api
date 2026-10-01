import type { APIGatewayProxyEventV2, Context, SQSEvent } from 'aws-lambda';
import type { Event } from '../packages/core/src/index.js';

export const event: Event = {
  version: 1,
  type: 'appointment.requested',
  insuredId: '00123',
  scheduleId: 123,
  countryISO: 'PE',
  appointmentId: '10000000-0000-4000-8000-000000000001',
  eventId: '10000000-0000-4000-8000-000000000002',
  correlationId: '10000000-0000-4000-8000-000000000003',
  occurredAt: '2026-10-01T00:00:00.000Z',
};

export function http(routeKey: string, body?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey,
    rawPath: '/appointments',
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    ...(body === undefined ? {} : { body }),
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      domainName: 'example.test',
      domainPrefix: 'api',
      requestId: 'request',
      routeKey,
      stage: 'demo',
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

export function sqs(...bodies: unknown[]): SQSEvent {
  return {
    Records: bodies.map((body, index) => ({
      messageId: `message-${index}`,
      body: JSON.stringify(body),
      receiptHandle: 'receipt',
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '0',
        SenderId: 'sender',
        ApproximateFirstReceiveTimestamp: '0',
      },
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: 'queue',
      awsRegion: 'us-east-1',
    })),
  };
}

export const context: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
  memoryLimitInMB: '256',
  awsRequestId: 'request',
  logGroupName: 'test',
  logStreamName: 'test',
  getRemainingTimeInMillis: () => 60000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};
