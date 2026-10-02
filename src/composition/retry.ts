import { retryHandler } from '#infrastructure/messaging/retry';
import { dispatcher, outbox } from './dynamo.js';
import { logger } from './config.js';

export const handleRetry = retryHandler(dispatcher, () => outbox.pendingAge(), logger);
