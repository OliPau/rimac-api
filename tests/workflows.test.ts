import { expect, test, vi } from 'vitest';
import { CreateAppointment } from '#application/appointments/use-cases/create';
import { DispatchPendingAppointments } from '#application/appointments/use-cases/dispatch';
import { ProcessAppointment } from '#application/appointments/use-cases/process';
import type { Event } from '#domain/appointments/index';
import type { Appointments, Outbox } from '#application/appointments/index';
import { accept } from '#application/appointments/helpers/registration';

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
  return { outbox, publisher, dispatcher: new DispatchPendingAppointments(outbox, publisher) };
}

test('returns a completed appointment without trying to publish it again', async () => {
  const { dispatcher, outbox, publisher } = setup();
  const completed = accept(event.appointmentId, event.occurredAt, 'completed');
  const appointments: Appointments = {
    create: vi.fn(async () => completed),
    list: vi.fn(),
    confirm: vi.fn(),
  };
  const report = vi.fn();
  expect(await new CreateAppointment(appointments, dispatcher, report).execute(event)).toEqual(
    completed,
  );
  expect(outbox.claim).not.toHaveBeenCalled();
  expect(publisher.publish).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});

test('marks publication only after successful delivery', async () => {
  const { dispatcher, outbox, publisher } = setup();
  expect(await dispatcher.execute()).toEqual({
    attempted: 1,
    sent: 1,
    skipped: 0,
    failed: 0,
    failures: [],
  });
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
  const create = new CreateAppointment(appointments, dispatcher, report);
  expect(await create.execute(event)).toEqual(accepted);
  vi.mocked(outbox.claim).mockRejectedValueOnce(new Error('Dynamo unavailable'));
  expect(await create.execute({ ...event, idempotencyKey: 'key' })).toEqual(accepted);
  expect(report).toHaveBeenCalledOnce();
  expect(appointments.create).toHaveBeenLastCalledWith(
    { insuredId: '00123', scheduleId: 1, countryISO: 'PE' },
    'key',
  );
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
  const worker = new ProcessAppointment('PE', store, publisher);
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
