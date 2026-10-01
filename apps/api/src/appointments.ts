import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { DynamoAppointments } from '@rimac/adapters/dynamo';
import { DynamoOutbox } from '@rimac/adapters/outbox';
import { SnsPublisher } from '@rimac/adapters/publish';
import { Create } from '@rimac/core/create';
import { Dispatcher } from '@rimac/core/dispatch';
import { env, logger } from './config.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));
export const appointments = new DynamoAppointments(client, {
  appointments: env('APPOINTMENTS_TABLE'),
  keys: env('KEYS_TABLE'),
  outbox: env('OUTBOX_TABLE'),
});
export const outbox = new DynamoOutbox(client, env('OUTBOX_TABLE'));
export const dispatcher = new Dispatcher(
  outbox,
  new SnsPublisher(new SNSClient({ maxAttempts: 2 }), env('TOPIC_ARN')),
);
export const create = new Create(appointments, dispatcher, () =>
  logger.warn('ImmediatePublishFailed'),
);
