import type { Event, Request } from '#domain/appointments/index';
import type { Acceptance } from '#application/appointments/dto/index';

export function accept(
  appointmentId: string,
  createdAt: string,
  status: Acceptance['status'] = 'pending',
): Acceptance {
  return {
    appointmentId,
    status,
    createdAt,
    message:
      status === 'completed'
        ? 'El agendamiento ya fue confirmado.'
        : 'El agendamiento está en proceso.',
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
