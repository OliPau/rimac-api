import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { expect, test } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CompletionPublisher } from '../packages/adapters/src/publish.js';
import type { Event } from '../packages/core/src/index.js';

const event: Event = {
  version: 1,
  type: 'appointment.completed',
  eventId: '10000000-0000-4000-8000-000000000001',
  appointmentId: '10000000-0000-4000-8000-000000000002',
  correlationId: '10000000-0000-4000-8000-000000000003',
  occurredAt: '2026-10-01T00:00:00Z',
  insuredId: '00123',
  scheduleId: 1,
  countryISO: 'PE',
};

test('requires a successful per-entry EventBridge receipt', async () => {
  const client = new EventBridgeClient({ region: 'us-east-1' });
  const send = mockClient(client);
  const publisher = new CompletionPublisher(client, 'rimac-demo');
  send
    .on(PutEventsCommand)
    .resolves({ FailedEntryCount: 1, Entries: [{ ErrorCode: 'InternalFailure' }] });
  await expect(publisher.publish(event)).rejects.toThrow('rejected');
  send.on(PutEventsCommand).resolves({
    FailedEntryCount: 0,
    Entries: [{ ErrorCode: 'AccessDeniedException' }],
  });
  await expect(publisher.publish(event)).rejects.toThrow('rejected');
  send.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [] });
  await expect(publisher.publish(event)).rejects.toThrow('Missing');
  send.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'receipt' }] });
  await publisher.publish(event);
  expect(send.calls()).toHaveLength(4);
  send.restore();
  client.destroy();
});
