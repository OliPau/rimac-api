import type { Request } from '#domain/appointments/index';

export interface CreateAppointmentDto extends Request {
  idempotencyKey?: string;
}

export interface Acceptance {
  appointmentId: string;
  status: 'pending';
  message: string;
  createdAt: string;
}
