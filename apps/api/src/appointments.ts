import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { DynamoAppointments } from '../../../packages/adapters/src/dynamo.js';
import { DynamoOutbox } from '../../../packages/adapters/src/outbox.js';
import { SnsPublisher } from '../../../packages/adapters/src/publish.js';
import { Create, Dispatcher } from '../../../packages/core/src/create.js';
import { env, logger } from './config.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));
export const appointments = new DynamoAppointments(client, {
  appointments: env('APPOINTMENTS_TABLE'),
  keys: env('KEYS_TABLE'),
  outbox: env('OUTBOX_TABLE'),
});
export const dispatcher = new Dispatcher(
  new DynamoOutbox(client, env('OUTBOX_TABLE')),
  new SnsPublisher(new SNSClient({ maxAttempts: 2 }), env('TOPIC_ARN')),
);
export const create = new Create(appointments, dispatcher, () =>
  logger.warn('ImmediatePublishFailed'),
);
