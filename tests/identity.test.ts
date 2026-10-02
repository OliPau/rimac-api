import { expect, test } from 'vitest';
import { identity } from '#domain/appointments/helpers/identity';
import { accept, requested } from '#application/appointments/helpers/registration';

test('preserves the deployed business identifier and acceptance contract', () => {
  const input = { insuredId: '00123', countryISO: 'PE' as const, scheduleId: 123 };
  const result = identity(input);
  expect(result).toEqual({
    fingerprint: '5ca6e749dafb3bfc095d8f7bcb7ec98c1a33a77e5ef197a64c164f55b0d88c30',
    appointmentId: '5ca6e749-dafb-4bfc-a95d-8f7bcb7ec98c',
  });
  const accepted = accept(result.appointmentId, '2026-10-01T00:00:00.000Z');
  expect(accepted).toEqual({
    appointmentId: result.appointmentId,
    status: 'pending',
    createdAt: '2026-10-01T00:00:00.000Z',
    message: 'El agendamiento está en proceso.',
  });
  expect(requested(input, accepted, 'event-id', 'correlation-id')).toEqual({
    ...input,
    appointmentId: accepted.appointmentId,
    version: 1,
    type: 'appointment.requested',
    eventId: 'event-id',
    correlationId: 'correlation-id',
    occurredAt: accepted.createdAt,
  });
  expect(identity({ ...input, countryISO: 'CL' })).not.toEqual(result);
});
