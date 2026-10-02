import { stackOutputs } from './cloud.js';
import { project, resource, stacks } from '../infra/config.js';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient, GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { DynamoAppointments } from '#infrastructure/persistence/dynamo/repository';
import { DynamoOutbox } from '#infrastructure/persistence/dynamo/outbox';
import { MysqlStore } from '#infrastructure/persistence/mysql/repository';
import { DataApi } from '#infrastructure/persistence/mysql/data-api';

const config = { region: project.region };
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(config));
const appointments = new DynamoAppointments(dynamo, {
  appointments: resource('appointments'),
  keys: resource('keys'),
  outbox: resource('outbox'),
});
const outbox = new DynamoOutbox(dynamo, resource('outbox'));
const insuredId = '00777';
const scheduleId = Date.now();

async function completed(id: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const page = await appointments.list(insuredId, 100);
    if (page.items.find((item) => item.appointmentId === id)?.status === 'completed') {
      return;
    }
    if (attempt % 6 === 0) {
      console.log('Waiting for recovery...');
    }
    await delay(5000);
  }
  throw new Error('Recovery did not complete');
}

const first = await appointments.create({ insuredId, scheduleId, countryISO: 'PE' });
console.log('Stored pending appointment without publishing to SNS');
await completed(first.appointmentId);
console.log('Scheduled DynamoDB outbox recovery verified');

const second = await appointments.create({
  insuredId,
  scheduleId: scheduleId + 1,
  countryISO: 'CL',
});
const event = await outbox.claim(second.appointmentId);
assert.ok(event);
const outputs = await stackOutputs(stacks.data);
const resourceArn = outputs.get('ClusterArn');
const secretArn = outputs.get('SecretCL');
assert.ok(resourceArn && secretArn);
const database = new DataApi(new RDSDataClient(config), {
  resourceArn,
  secretArn,
  database: 'appointments_cl',
});
const store = new MysqlStore(database);
const saved = await store.save(event);
assert.equal(saved.published, false);
console.log('Committed SQL appointment and outbox without publishing to EventBridge');
const sqs = new SQSClient(config);
const queue = await sqs.send(new GetQueueUrlCommand({ QueueName: resource('SQS_CL') }));
assert.ok(queue.QueueUrl);
for (let duplicate = 0; duplicate < 2; duplicate++) {
  await sqs.send(
    new SendMessageCommand({ QueueUrl: queue.QueueUrl, MessageBody: JSON.stringify(event) }),
  );
}
await outbox.sent(event);
await completed(second.appointmentId);
assert.equal((await store.save(event)).published, true);
const bridge = new EventBridgeClient(config);
for (let duplicate = 0; duplicate < 2; duplicate++) {
  const result = await bridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: stacks.application,
          Source: 'rimac.appointments',
          DetailType: 'appointment.completed',
          Detail: JSON.stringify(saved.confirmation),
        },
      ],
    }),
  );
  assert.equal(result.FailedEntryCount, 0);
}
await delay(5000);
await completed(second.appointmentId);
const [row] = await database.execute('SELECT COUNT(*) AS total FROM appointments WHERE id = :id', {
  id: second.appointmentId,
});
assert.equal(row?.total, 1);
await writeFile(
  'delivery/recovery.json',
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      dynamoOutbox: true,
      mysqlOutbox: true,
      duplicateCountryMessages: true,
      duplicateConfirmations: true,
    },
    null,
    2,
  ),
);
console.log('SQL outbox recovery and duplicate messages verified');
