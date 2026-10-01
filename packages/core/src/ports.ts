import type { Acceptance, Event, Page, Request } from './models.js';

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
