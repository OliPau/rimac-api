import { randomInt } from 'node:crypto';

interface BackoffOptions {
  baseMs: number;
  jitterMs: number;
  maximumMs?: number;
}

export function backoffDelay(attempt: number, options: BackoffOptions): number {
  const exponentialMs = options.baseMs * 2 ** attempt;
  const jitterMs = randomInt(options.jitterMs);
  return Math.min(options.maximumMs ?? Infinity, exponentialMs + jitterMs);
}
