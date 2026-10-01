import { randomUUID } from 'node:crypto';
import { event as eventSchema } from '@rimac/contracts';
import type { CountryStore, Event } from '@rimac/core';

export type Parameters = Record<string, string | number>;
export interface Sql {
  execute(sql: string, parameters?: Parameters): Promise<Record<string, unknown>[]>;
}
export interface Database extends Sql {
  transaction<T>(action: (sql: Sql) => Promise<T>): Promise<T>;
}

export class MysqlStore implements CountryStore {
  constructor(private readonly database: Database) {}

  async save(event: Event) {
    return this.database.transaction(async (sql) => {
      await sql.execute(
        `INSERT IGNORE INTO appointments
          (id, insured_id, schedule_id, country_iso, created_at)
         VALUES (:id, :insured, :schedule, :country, :created)`,
        {
          id: event.appointmentId,
          insured: event.insuredId,
          schedule: event.scheduleId,
          country: event.countryISO,
          created: event.occurredAt,
        },
      );
      const [saved] = await sql.execute(
        'SELECT insured_id, schedule_id, country_iso FROM appointments WHERE id = :id',
        { id: event.appointmentId },
      );
      if (
        !saved ||
        saved.insured_id !== event.insuredId ||
        Number(saved.schedule_id) !== event.scheduleId ||
        saved.country_iso !== event.countryISO
      ) {
        throw new Error('Conflicting country appointment');
      }
      const confirmation: Event = {
        ...event,
        eventId: randomUUID(),
        type: 'appointment.completed',
        occurredAt: new Date().toISOString(),
      };
      await sql.execute(
        `INSERT IGNORE INTO outbox (appointment_id, event_id, payload, published)
         VALUES (:id, :event, :payload, 0)`,
        {
          id: event.appointmentId,
          event: confirmation.eventId,
          payload: JSON.stringify(confirmation),
        },
      );
      const [row] = await sql.execute(
        'SELECT payload, published FROM outbox WHERE appointment_id = :id',
        {
          id: event.appointmentId,
        },
      );
      if (!row || typeof row.payload !== 'string') {
        throw new Error('Missing confirmation outbox');
      }
      return {
        confirmation: eventSchema.parse(JSON.parse(row.payload)),
        published: Number(row.published) === 1,
      };
    });
  }

  async published(eventId: string): Promise<void> {
    await this.database.execute('UPDATE outbox SET published = 1 WHERE event_id = :event', {
      event: eventId,
    });
  }
}
