import { expect, test, vi } from 'vitest';
import { ListAppointments } from '#application/appointments/use-cases/list';
import { ConfirmAppointment } from '#application/appointments/use-cases/confirm';
import type { Appointments } from '#application/appointments/ports/index';
import { event } from './fixtures.js';

function repository(): Appointments {
  return {
    create: vi.fn(),
    list: vi.fn(async () => ({ items: [] })),
    confirm: vi.fn(async () => undefined),
  };
}

test('applies pagination defaults and rejects unsupported sizes before querying storage', async () => {
  const appointments = repository();
  const list = new ListAppointments(appointments);
  expect(await list.execute({ insuredId: '00123' })).toEqual({ items: [] });
  expect(appointments.list).toHaveBeenCalledWith('00123', 20, undefined);
  await list.execute({ insuredId: '00123', limit: 100, cursor: 'cursor' });
  expect(appointments.list).toHaveBeenLastCalledWith('00123', 100, 'cursor');
  for (const limit of [1.5, 0, 101]) {
    expect(() => list.execute({ insuredId: '00123', limit })).toThrow('Invalid page size');
  }
  expect(appointments.list).toHaveBeenCalledTimes(2);
});

test('rejects request events and delegates valid confirmations to conditional persistence', async () => {
  const appointments = repository();
  const confirm = new ConfirmAppointment(appointments);
  await expect(confirm.execute(event)).rejects.toThrow('Unexpected confirmation type');
  expect(appointments.confirm).not.toHaveBeenCalled();
  const completed = { ...event, type: 'appointment.completed' as const };
  await confirm.execute(completed);
  expect(appointments.confirm).toHaveBeenCalledWith(completed);
});
