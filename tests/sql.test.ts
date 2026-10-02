import { expect, test, vi } from 'vitest';
import { MysqlStore, type Database, type Sql } from '#infrastructure/persistence/mysql/repository';
import { event } from './fixtures.js';

test.each([
  undefined,
  { insured_id: '99999', schedule_id: 123, country_iso: 'PE' },
  { insured_id: '00123', schedule_id: 124, country_iso: 'PE' },
  { insured_id: '00123', schedule_id: 123, country_iso: 'CL' },
])('rejects a mismatched persisted appointment %j', async (saved) => {
  const sql: Sql = {
    execute: vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(saved ? [saved] : []),
  };
  const database: Database = { ...sql, transaction: (action) => action(sql) };
  await expect(new MysqlStore(database).save(event)).rejects.toThrow(
    'Conflicting country appointment',
  );
});

test.each([undefined, { payload: 123 }, { payload: '{}' }])(
  'rejects incomplete confirmation outbox data %j',
  async (row) => {
    const sql: Sql = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ insured_id: '00123', schedule_id: 123, country_iso: 'PE' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(row ? [row] : []),
    };
    const database: Database = { ...sql, transaction: (action) => action(sql) };
    await expect(new MysqlStore(database).save(event)).rejects.toThrow();
  },
);
