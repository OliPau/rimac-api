import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createConnection, type Connection } from 'mysql2/promise';
import { beforeAll, afterAll, expect, test } from 'vitest';
import {
  MysqlStore,
  type Database,
  type Parameters,
} from '#infrastructure/persistence/mysql/repository';
import type { Event } from '#domain/appointments/index';

let connection: Connection;

async function execute(
  sql: string,
  parameters: Parameters = {},
): Promise<Record<string, unknown>[]> {
  const [rows] = await connection.execute(sql, parameters);
  return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
}

const database: Database = {
  execute,
  async transaction(action) {
    await connection.beginTransaction();
    try {
      const result = await action({ execute });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  },
};
const store = new MysqlStore(database);
const event: Event = {
  version: 1,
  type: 'appointment.requested',
  eventId: randomUUID(),
  appointmentId: randomUUID(),
  correlationId: randomUUID(),
  occurredAt: new Date().toISOString(),
  insuredId: '00123',
  scheduleId: Date.now(),
  countryISO: 'PE',
};

beforeAll(async () => {
  connection = await createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'test',
    password: 'local-only-test',
    database: 'appointments_pe',
    namedPlaceholders: true,
    supportBigNumbers: true,
  });
  const migration = await readFile('infra/migrations/001.sql', 'utf8');
  for (const sql of migration.split(';').filter((statement) => statement.trim())) {
    await connection.query(sql);
  }
});
afterAll(async () => {
  await connection?.end();
});

test('commits one appointment and a stable confirmation across retries', async () => {
  const first = await store.save(event);
  const repeated = await store.save(event);
  expect(repeated).toEqual(first);
  expect(first.published).toBe(false);
  await store.published(first.confirmation.eventId);
  expect((await store.save(event)).published).toBe(true);
  const [row] = await execute('SELECT COUNT(*) AS total FROM appointments WHERE id = :id', {
    id: event.appointmentId,
  });
  expect(row?.total).toBe(1);
});

test('rolls back mismatched business identifiers', async () => {
  await expect(store.save({ ...event, appointmentId: randomUUID() })).rejects.toThrow(
    'Conflicting',
  );
  await expect(store.save({ ...event, insuredId: '99999' })).rejects.toThrow('Conflicting');
});

test('rolls back the appointment when writing its confirmation fails', async () => {
  const request = { ...event, appointmentId: randomUUID(), scheduleId: event.scheduleId + 1 };
  const failingDatabase: Database = {
    execute,
    transaction: (action) =>
      database.transaction((sql) =>
        action({
          execute(statement, parameters) {
            if (statement.startsWith('INSERT IGNORE INTO outbox')) {
              throw new Error('Simulated confirmation write failure');
            }
            return sql.execute(statement, parameters);
          },
        }),
      ),
  };
  await expect(new MysqlStore(failingDatabase).save(request)).rejects.toThrow(
    'Simulated confirmation write failure',
  );
  expect(
    await execute('SELECT id FROM appointments WHERE id = :id', {
      id: request.appointmentId,
    }),
  ).toEqual([]);
  expect(
    await execute('SELECT event_id FROM outbox WHERE appointment_id = :id', {
      id: request.appointmentId,
    }),
  ).toEqual([]);
  const saved = await store.save(request);
  expect(await store.save(request)).toEqual(saved);
});
