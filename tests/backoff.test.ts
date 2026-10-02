import { randomInt } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { backoffDelay } from '#infrastructure/shared/backoff';

vi.mock('node:crypto', () => ({ randomInt: vi.fn() }));

afterEach(() => vi.resetAllMocks());

test.each([
  { baseMs: 10, jitterMs: 20 },
  { baseMs: 1000, jitterMs: 500 },
  { baseMs: 1000, jitterMs: 1000 },
])('preserves exponential waits and exclusive jitter bounds for %o', (options) => {
  for (const attempt of [0, 1, 3]) {
    vi.mocked(randomInt).mockImplementationOnce(() => 0);
    expect(backoffDelay(attempt, options)).toBe(options.baseMs * 2 ** attempt);
    vi.mocked(randomInt).mockImplementationOnce(() => options.jitterMs - 1);
    expect(backoffDelay(attempt, options)).toBe(
      options.baseMs * 2 ** attempt + options.jitterMs - 1,
    );
    expect(randomInt).toHaveBeenLastCalledWith(options.jitterMs);
  }
});

test('preserves whole-second outbox scheduling and caps the total wait at fifteen minutes', () => {
  const options = { baseMs: 1000, jitterMs: 10000, maximumMs: 900000 };
  vi.mocked(randomInt).mockImplementation(() => 9999);
  expect(Math.floor(backoffDelay(1, options) / 1000)).toBe(11);
  expect(backoffDelay(10, options)).toBe(900000);
});
