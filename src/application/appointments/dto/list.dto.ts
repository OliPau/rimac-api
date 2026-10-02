import type { Appointment } from '#domain/appointments/index';

export interface ListAppointmentsDto {
  insuredId: string;
  limit?: number;
  cursor?: string;
}

export interface Page {
  items: Appointment[];
  cursor?: string;
}
