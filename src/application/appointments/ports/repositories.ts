import type { Event, Request } from '#domain/appointments/index';
import type { Acceptance, Page } from '#application/appointments/dto/index';

export interface Appointments {
  create(input: Request, key?: string): Promise<Acceptance>;
  list(insuredId: string, limit: number, cursor?: string): Promise<Page>;
  confirm(event: Event): Promise<void>;
}
export interface CountryStore {
  save(event: Event): Promise<{ confirmation: Event; published: boolean }>;
  published(eventId: string): Promise<void>;
}
