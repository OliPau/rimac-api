import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { DynamoAppointments } from '#infrastructure/persistence/dynamo/repository';
import { DynamoOutbox } from '#infrastructure/persistence/dynamo/outbox';
import { SnsPublisher } from '#infrastructure/messaging/publish';
import { DispatchPendingAppointments } from '#application/appointments/use-cases/dispatch';
import { env } from './config.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));
export const appointments = new DynamoAppointments(client, {
  appointments: env('APPOINTMENTS_TABLE'),
  keys: env('KEYS_TABLE'),
  outbox: env('OUTBOX_TABLE'),
});
export const outbox = new DynamoOutbox(client, env('OUTBOX_TABLE'));
export const dispatcher = new DispatchPendingAppointments(
  outbox,
  new SnsPublisher(new SNSClient({ maxAttempts: 2 }), env('TOPIC_ARN')),
);
