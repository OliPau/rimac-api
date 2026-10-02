import type { Country, Event } from '#domain/appointments/index';
import type { CountryStore, Publisher } from '#application/appointments/ports/index';

export class ProcessAppointment {
  constructor(
    private readonly country: Country,
    private readonly store: CountryStore,
    private readonly publisher: Publisher,
  ) {}

  async execute(event: Event): Promise<void> {
    if (event.countryISO !== this.country || event.type !== 'appointment.requested') {
      throw new Error('Unexpected country or event type');
    }

    const result = await this.store.save(event);
    if (result.published) {
      return;
    }

    await this.publisher.publish(result.confirmation);
    await this.store.published(result.confirmation.eventId);
  }
}
