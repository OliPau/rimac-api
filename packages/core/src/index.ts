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
export class Conflict extends Error {}
export class InvalidCursor extends Error {}
export interface Appointments {
  create(input: Request, key?: string): Promise<Acceptance>;
  list(insuredId: string, limit: number, cursor?: string): Promise<Page>;
  confirm(event: Event): Promise<void>;
}
export interface Outbox {
  claim(id: string): Promise<Event | undefined>;
  sent(event: Event): Promise<void>;
  failed(event: Event): Promise<void>;
  due(limit: number): Promise<string[]>;
}
export interface Publisher {
  publish(event: Event): Promise<void>;
}
export interface CountryStore {
  save(event: Event): Promise<{ confirmation: Event; published: boolean }>;
  published(eventId: string): Promise<void>;
}
