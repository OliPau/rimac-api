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
  dispatch(id: string): Promise<void>;
}
