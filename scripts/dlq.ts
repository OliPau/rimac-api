import { project, resource } from '../infra/config.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  SQSClient,
  GetQueueUrlCommand,
  SendMessageCommand,
  GetQueueAttributesCommand,
  StartMessageMoveTaskCommand,
} from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoAppointments } from '../packages/adapters/src/dynamo.js';
import { DynamoOutbox } from '../packages/adapters/src/outbox.js';
import { appointment as schema } from '../packages/contracts/src/index.js';

const config = { region: project.region };
const sqs = new SQSClient(config);
const client = DynamoDBDocumentClient.from(new DynamoDBClient(config));
const tables = {
  appointments: resource('appointments'),
  keys: resource('keys'),
  outbox: resource('outbox'),
};
const store = new DynamoAppointments(client, tables);
const outbox = new DynamoOutbox(client, tables.outbox);

async function queue(name: string) {
  const result = await sqs.send(new GetQueueUrlCommand({ QueueName: resource(name) }));
  assert.ok(result.QueueUrl);
  return result.QueueUrl;
}

if (process.argv[2] === 'start') {
  const input = { insuredId: '00888', scheduleId: Date.now(), countryISO: 'PE' as const };
  const accepted = await store.create(input);
  const event = await outbox.claim(accepted.appointmentId);
  assert.ok(event);
  const saved = {
    ...input,
    appointmentId: accepted.appointmentId,
    status: 'pending',
    createdAt: accepted.createdAt,
  };
  await writeFile('delivery/dlq-pending.json', JSON.stringify(saved, null, 2));
  // Remove only this newly created test row so confirmation processing fails conditionally.
  await client.send(
    new DeleteCommand({
      TableName: tables.appointments,
      Key: { insuredId: input.insuredId, appointmentId: accepted.appointmentId },
      ConditionExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':pending': 'pending' },
    }),
  );
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: await queue('confirmations'),
      MessageBody: JSON.stringify({
        ...event,
        type: 'appointment.completed',
        eventId: randomUUID(),
      }),
    }),
  );
  await outbox.sent(event);
  console.log('Persistent confirmation failure started; source visibility remains 90 seconds');
} else if (process.argv[2] === 'recover') {
  const saved = schema.parse(JSON.parse(await readFile('delivery/dlq-pending.json', 'utf8')));
  const QueueUrl = await queue('confirmation-dlq');
  const attributes = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl,
      AttributeNames: ['QueueArn', 'ApproximateNumberOfMessages'],
    }),
  );
  assert.ok(
    Number(attributes.Attributes?.ApproximateNumberOfMessages) >= 1,
    'Wait until the message reaches the DLQ',
  );
  const SourceArn = attributes.Attributes?.QueueArn;
  assert.ok(SourceArn);
  await client.send(
    new PutCommand({
      TableName: tables.appointments,
      Item: saved,
      ConditionExpression: 'attribute_not_exists(appointmentId)',
    }),
  );
  const result = await sqs.send(
    new StartMessageMoveTaskCommand({ SourceArn, MaxNumberOfMessagesPerSecond: 1 }),
  );
  for (let attempt = 0; attempt < 60; attempt++) {
    const page = await store.list(saved.insuredId, 100);
    if (
      page.items.find((item) => item.appointmentId === saved.appointmentId)?.status === 'completed'
    ) {
      await writeFile(
        'delivery/dlq.json',
        JSON.stringify(
          {
            testedAt: new Date().toISOString(),
            reachedDlq: true,
            redriveRecovered: true,
            taskHandle: result.TaskHandle,
          },
          null,
          2,
        ),
      );
      console.log('Native DLQ redrive recovered the appointment');
      process.exit(0);
    }
    await delay(5000);
  }
  throw new Error('Redrive did not complete');
} else {
  throw new Error('Use start or recover');
}
