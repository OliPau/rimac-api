import type { Event, Request } from '#domain/appointments/index';
import type { Acceptance } from '#application/appointments/dto/index';

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
