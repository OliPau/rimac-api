import { createHash } from 'node:crypto';
import type { Acceptance, Event, Request } from './models.js';

export function identity(input: Request) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([input.insuredId, input.countryISO, input.scheduleId]))
    .digest('hex');
  const hash = fingerprint;
  const appointmentId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { fingerprint, appointmentId };
}

export function accept(appointmentId: string, createdAt: string): Acceptance {
  return {
    appointmentId,
    status: 'pending',
    createdAt,
    message: 'El agendamiento está en proceso.',
  };
}

export function requested(
  input: Request,
  accepted: Acceptance,
  eventId: string,
  correlationId: string,
): Event {
  return {
    ...input,
    version: 1,
    type: 'appointment.requested',
    eventId,
    appointmentId: accepted.appointmentId,
    correlationId,
    occurredAt: accepted.createdAt,
  };
}
