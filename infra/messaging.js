const arn = (name) => ({ 'Fn::GetAtt': [name, 'Arn'] });
const ref = (name) => ({ Ref: name });

function queue(name, visibility, deadLetter) {
  return {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: `rimac-demo-${name}`,
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: deadLetter ? 345600 : 1209600,
      VisibilityTimeout: visibility,
      ...(deadLetter
        ? { RedrivePolicy: { deadLetterTargetArn: arn(deadLetter), maxReceiveCount: 5 } }
        : {}),
    },
  };
}

function policy(queueName, service, source) {
  return {
    Type: 'AWS::SQS::QueuePolicy',
    Properties: {
      Queues: [ref(queueName)],
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: service },
            Action: 'sqs:SendMessage',
            Resource: arn(queueName),
            Condition: { ArnEquals: { 'aws:SourceArn': source } },
          },
        ],
      },
    },
  };
}

export function messaging() {
  const resources = {
    Topic: {
      Type: 'AWS::SNS::Topic',
      Properties: { TopicName: 'rimac-demo', KmsMasterKeyId: 'alias/aws/sns' },
    },
    Bus: { Type: 'AWS::Events::EventBus', Properties: { Name: 'rimac-demo' } },
    ConfirmationDLQ: queue('confirmation-dlq', 90),
    EventDeliveryDLQ: queue('event-delivery-dlq', 90),
    ConfirmationQueue: queue('confirmations', 90, 'ConfirmationDLQ'),
    CompletionRule: {
      Type: 'AWS::Events::Rule',
      Properties: {
        EventBusName: ref('Bus'),
        EventPattern: { source: ['rimac.appointments'], 'detail-type': ['appointment.completed'] },
        Targets: [
          {
            Id: 'confirmations',
            Arn: arn('ConfirmationQueue'),
            InputPath: '$.detail',
            DeadLetterConfig: { Arn: arn('EventDeliveryDLQ') },
            RetryPolicy: { MaximumEventAgeInSeconds: 86400, MaximumRetryAttempts: 185 },
          },
        ],
      },
    },
    ConfirmationPolicy: policy('ConfirmationQueue', 'events.amazonaws.com', arn('CompletionRule')),
    EventDeliveryPolicy: policy('EventDeliveryDLQ', 'events.amazonaws.com', arn('CompletionRule')),
  };
  for (const country of ['PE', 'CL']) {
    resources[`DLQ${country}`] = queue(`${country}-dlq`, 360);
    resources[`DeliveryDLQ${country}`] = queue(`${country}-delivery-dlq`, 360);
    resources[`Queue${country}`] = queue(`SQS_${country}`, 360, `DLQ${country}`);
    resources[`Policy${country}`] = policy(`Queue${country}`, 'sns.amazonaws.com', ref('Topic'));
    resources[`DeliveryPolicy${country}`] = policy(
      `DeliveryDLQ${country}`,
      'sns.amazonaws.com',
      ref('Topic'),
    );
    resources[`Subscription${country}`] = {
      Type: 'AWS::SNS::Subscription',
      DependsOn: [`Policy${country}`, `DeliveryPolicy${country}`],
      Properties: {
        TopicArn: ref('Topic'),
        Protocol: 'sqs',
        Endpoint: arn(`Queue${country}`),
        RawMessageDelivery: true,
        FilterPolicy: { countryISO: [country] },
        RedrivePolicy: { deadLetterTargetArn: arn(`DeliveryDLQ${country}`) },
      },
    };
  }
  return resources;
}
