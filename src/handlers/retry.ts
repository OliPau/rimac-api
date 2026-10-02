import { handleRetry } from '../composition/retry.js';

export async function handler() {
  return handleRetry();
}
