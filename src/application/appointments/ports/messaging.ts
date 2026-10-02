import type { Event } from '#domain/appointments/index';

export interface Outbox {
  claim(id: string): Promise<Event | undefined>;
  sent(event: Event): Promise<void>;
  failed(event: Event): Promise<void>;
  due(limit: number): Promise<string[]>;
}
export interface Publisher {
  publish(event: Event): Promise<void>;
}
export interface PublicationDispatch {
  dispatch(id: string): Promise<PublicationResult>;
}

export interface PublicationFailure {
  status: 'failed';
  appointmentId: string;
  correlationId?: string;
  phase: 'claim' | 'publish' | 'sent' | 'dispatch';
  cause: unknown;
  recovery?: { phase: 'reschedule'; cause: unknown };
}

export type PublicationResult = { status: 'sent' | 'skipped' } | PublicationFailure;

export interface DispatchBatch {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  failures: PublicationFailure[];
}
