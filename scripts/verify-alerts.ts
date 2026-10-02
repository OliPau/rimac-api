import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import {
  CloudWatchClient,
  DeleteAlarmsCommand,
  PutMetricAlarmCommand,
  SetAlarmStateCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  SNSClient,
  GetTopicAttributesCommand,
  SubscribeCommand,
  UnsubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { stackOutputs } from './cloud.js';
import { project, resource, stacks } from '../infra/config.js';

const config = { region: project.region };
const sns = new SNSClient(config);
const sqs = new SQSClient(config);
const cloudwatch = new CloudWatchClient(config);
const TopicArn = (await stackOutputs(stacks.cost)).get('AlertsArn');
const attributes = await sns.send(new GetTopicAttributesCommand({ TopicArn }));
const key = attributes.Attributes?.KmsMasterKeyId;
assert.ok(key?.startsWith('arn:aws:kms:'), 'Alerts must use a customer-managed key');
const AlarmName = resource(`security-verification-${randomUUID()}`);
const created = await sqs.send(
  new CreateQueueCommand({
    QueueName: AlarmName,
    Attributes: { SqsManagedSseEnabled: 'true', MessageRetentionPeriod: '300' },
    tags: { Project: project.service },
  }),
);
const QueueUrl = created.QueueUrl;
assert.ok(QueueUrl);
let subscription: string | undefined;
try {
  const queue = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }),
  );
  const queueArn = queue.Attributes?.QueueArn;
  assert.ok(queueArn);
  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl,
      Attributes: {
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'sns.amazonaws.com' },
              Action: 'sqs:SendMessage',
              Resource: queueArn,
              Condition: { ArnEquals: { 'aws:SourceArn': TopicArn } },
            },
          ],
        }),
      },
    }),
  );
  subscription = (
    await sns.send(
      new SubscribeCommand({
        TopicArn,
        Protocol: 'sqs',
        Endpoint: queueArn,
        ReturnSubscriptionArn: true,
      }),
    )
  ).SubscriptionArn;
  assert.ok(subscription);
  await cloudwatch.send(
    new PutMetricAlarmCommand({
      AlarmName,
      Namespace: 'RimacVerification',
      MetricName: 'EncryptedDelivery',
      Statistic: 'Sum',
      Period: 60,
      EvaluationPeriods: 1,
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'ignore',
      AlarmActions: [TopicArn],
      Tags: [{ Key: 'Project', Value: project.service }],
    }),
  );
  await cloudwatch.send(
    new SetAlarmStateCommand({
      AlarmName,
      StateValue: 'ALARM',
      StateReason: 'Controlled encrypted alert delivery verification',
    }),
  );
  let received = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const messages = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl, WaitTimeSeconds: 20, MaxNumberOfMessages: 10 }),
    );
    received = messages.Messages?.some(({ Body }) => Body?.includes(AlarmName)) ?? false;
    if (received) {
      break;
    }
    console.log('Waiting for encrypted CloudWatch alert delivery');
  }
  assert.ok(received, 'CloudWatch did not deliver through the encrypted topic');
  await writeFile(
    'delivery/encrypted-alerts.json',
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        topic: TopicArn,
        key,
        cloudwatchDelivery: true,
        budgetsDelivery: 'pending natural budget threshold notification',
      },
      null,
      2,
    ),
  );
  console.log('CloudWatch delivered successfully through the encrypted SNS topic');
} finally {
  await cloudwatch.send(new DeleteAlarmsCommand({ AlarmNames: [AlarmName] }));
  if (subscription) {
    await sns.send(new UnsubscribeCommand({ SubscriptionArn: subscription }));
  }
  await sqs.send(new DeleteQueueCommand({ QueueUrl }));
}
