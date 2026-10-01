import type { SQSEvent, Context } from 'aws-lambda';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { Worker } from '../../../packages/core/src/worker.js';
import { DataApi } from '../../../packages/adapters/src/data-api.js';
import { MysqlStore } from '../../../packages/adapters/src/sql.js';
import { CompletionPublisher } from '../../../packages/adapters/src/publish.js';
import { env, logger } from './config.js';
import { batch } from './batch.js';

const country = env('COUNTRY');
if (country !== 'PE' && country !== 'CL') {
  throw new Error('Invalid worker country');
}
const worker = new Worker(
  country,
  new MysqlStore(
    new DataApi(new RDSDataClient({ maxAttempts: 2 }), {
      resourceArn: env('CLUSTER_ARN'),
      secretArn: env('SECRET_ARN'),
      database: env('DATABASE'),
    }),
  ),
  new CompletionPublisher(new EventBridgeClient({ maxAttempts: 2 }), env('EVENT_BUS')),
);

export async function handler(event: SQSEvent, context: Context) {
  logger.addContext(context);
  return batch(
    event,
    async (message) => {
      await worker.execute(message);
      logger.info('CountrySaved', {
        appointmentId: message.appointmentId,
        correlationId: message.correlationId,
        country,
      });
    },
    (messageId, errorName) => logger.error('CountryFailed', { messageId, errorName, country }),
  );
}
