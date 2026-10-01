import { dispatcher } from './appointments.js';
import { logger } from './config.js';

export async function handler() {
  const count = await dispatcher.retry();
  logger.info('OutboxRetry', { count });
}
