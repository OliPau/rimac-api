import { expect, test } from 'vitest';
import { request } from '#infrastructure/shared/appointment.schema';
import { event } from '#infrastructure/messaging/dto/event.dto';
import { idempotencyKey, query } from '#infrastructure/http/dto/appointment.dto';

test('preserves leading zeroes and accepts both countries', () => {
  for (const countryISO of ['PE', 'CL']) {
    expect(request.parse({ insuredId: '00123', scheduleId: 1, countryISO }).insuredId).toBe(
      '00123',
    );
  }
});
test.each([
  { insuredId: 123 },
  { insuredId: '1234' },
  { insuredId: '123456' },
  { insuredId: 'abcde' },
  { scheduleId: 0 },
  { scheduleId: -1 },
  { scheduleId: 1.5 },
  { scheduleId: '1' },
  { scheduleId: Number.MAX_SAFE_INTEGER + 1 },
  { countryISO: 'AR' },
  { extra: true },
])('rejects invalid input %j', (override) => {
  expect(
    request.safeParse({ insuredId: '00123', scheduleId: 1, countryISO: 'PE', ...override }).success,
  ).toBe(false);
});
test('validates pagination and idempotency keys', () => {
  expect(query.parse({})).toEqual({ limit: 20 });
  for (const limit of ['0', '-1', '101', '1.2', 'foo']) {
    expect(query.safeParse({ limit }).success).toBe(false);
  }
  expect(idempotencyKey.safeParse(' space').success).toBe(false);
  expect(idempotencyKey.safeParse('request-123').success).toBe(true);
});
test('rejects unknown or incomplete event versions', () => {
  expect(event.safeParse({ version: 2 }).success).toBe(false);
});
