import type { SQSEvent, Context } from 'aws-lambda';
import { handleCountry } from '../composition/worker.js';
import { logger } from '../composition/config.js';

export async function handler(event: SQSEvent, context: Context) {
  logger.addContext(context);
  return handleCountry(event);
}
