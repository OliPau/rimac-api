export type Country = 'PE' | 'CL';
export interface Request {
  insuredId: string;
  scheduleId: number;
  countryISO: Country;
}
export interface Acceptance {
  appointmentId: string;
  status: 'pending';
  message: string;
  createdAt: string;
}
export interface Appointment extends Request {
  appointmentId: string;
  status: 'pending' | 'completed';
  createdAt: string;
}
export interface Event extends Request {
  version: 1;
  type: 'appointment.requested' | 'appointment.completed';
  eventId: string;
  appointmentId: string;
  correlationId: string;
  occurredAt: string;
}
export interface Page {
  items: Appointment[];
  cursor?: string;
}
