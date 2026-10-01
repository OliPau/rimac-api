import { expect, test, vi } from 'vitest';
import { Create, Dispatcher } from '../packages/core/src/create.js';
import { Worker } from '../packages/core/src/worker.js';
import type { Appointments, Event, Outbox } from '../packages/core/src/index.js';

const event: Event = {
  version: 1,
  type: 'appointment.requested',
  eventId: '10000000-0000-4000-8000-000000000001',
  appointmentId: '10000000-0000-4000-8000-000000000002',
  correlationId: '10000000-0000-4000-8000-000000000003',
  occurredAt: '2026-10-01T00:00:00Z',
  countryISO: 'PE',
  insuredId: '00123',
  scheduleId: 1,
};

function setup() {
  const outbox: Outbox = {
    claim: vi.fn(async () => event),
    sent: vi.fn(async () => undefined),
    failed: vi.fn(async () => undefined),
    due: vi.fn(async () => [event.appointmentId]),
  };
  const publisher = { publish: vi.fn(async () => undefined) };
  return { outbox, publisher, dispatcher: new Dispatcher(outbox, publisher) };
}

test('marks publication only after successful delivery', async () => {
  const { dispatcher, outbox, publisher } = setup();
  expect(await dispatcher.retry()).toBe(1);
  expect(publisher.publish).toHaveBeenCalledWith(event);
  expect(outbox.sent).toHaveBeenCalledWith(event);
  expect(outbox.failed).not.toHaveBeenCalled();
});

test('retains failed publications for retry', async () => {
  const { dispatcher, publisher, outbox } = setup();
  publisher.publish.mockRejectedValueOnce(new Error('SNS unavailable'));
  await dispatcher.dispatch(event.appointmentId);
  expect(outbox.sent).not.toHaveBeenCalled();
  expect(outbox.failed).toHaveBeenCalledWith(event);
});

test('skips leased or published events', async () => {
  const { dispatcher, outbox, publisher } = setup();
  vi.mocked(outbox.claim).mockResolvedValueOnce(undefined);
  await dispatcher.dispatch(event.appointmentId);
  expect(publisher.publish).not.toHaveBeenCalled();
});

test('returns durable acceptance even if the immediate outbox attempt fails', async () => {
  const { dispatcher, outbox } = setup();
  const accepted = {
    appointmentId: event.appointmentId,
    status: 'pending' as const,
    message: 'El agendamiento está en proceso.',
    createdAt: event.occurredAt,
  };
  const appointments: Appointments = {
    create: vi.fn(async () => accepted),
    list: vi.fn(),
    confirm: vi.fn(),
  };
  const report = vi.fn();
  const create = new Create(appointments, dispatcher, report);
  expect(await create.execute(event)).toEqual(accepted);
  vi.mocked(outbox.claim).mockRejectedValueOnce(new Error('Dynamo unavailable'));
  expect(await create.execute(event, 'key')).toEqual(accepted);
  expect(report).toHaveBeenCalledOnce();
  vi.mocked(appointments.create).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(create.execute(event)).rejects.toThrow('Storage unavailable');
});

test('recovers publication after SQL commit without recreating an appointment', async () => {
  const confirmation: Event = { ...event, type: 'appointment.completed' };
  const store = {
    save: vi.fn(async () => ({ confirmation, published: false })),
    published: vi.fn(async () => undefined),
  };
  const publisher = { publish: vi.fn(async () => undefined) };
  const worker = new Worker('PE', store, publisher);
  publisher.publish.mockRejectedValueOnce(new Error('EventBridge unavailable'));
  await expect(worker.execute(event)).rejects.toThrow('EventBridge unavailable');
  expect(store.published).not.toHaveBeenCalled();
  await worker.execute(event);
  expect(store.published).toHaveBeenCalledWith(confirmation.eventId);
  store.save.mockResolvedValueOnce({ confirmation, published: true });
  await worker.execute(event);
  expect(publisher.publish).toHaveBeenCalledTimes(2);
  await expect(worker.execute({ ...event, countryISO: 'CL' })).rejects.toThrow('Unexpected');
  await expect(worker.execute(confirmation)).rejects.toThrow('Unexpected');
});
