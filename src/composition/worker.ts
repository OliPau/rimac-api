import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { ProcessAppointment } from '#application/appointments/use-cases/process';
import { DataApi } from '#infrastructure/persistence/mysql/data-api';
import { MysqlStore } from '#infrastructure/persistence/mysql/repository';
import { CompletionPublisher } from '#infrastructure/messaging/publish';
import { env, logger } from './config.js';
import { countryHandler } from '#infrastructure/sqs/country';

const country = env('COUNTRY');
if (country !== 'PE' && country !== 'CL') {
  throw new Error('Invalid worker country');
}
const worker = new ProcessAppointment(
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

export const handleCountry = countryHandler(worker, country, logger);
