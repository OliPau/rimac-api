const arn = (name) => ({ 'Fn::GetAtt': [name, 'Arn'] });
const allow = (Action, Resource) => ({ Effect: 'Allow', Action, Resource });

function role(name, statements) {
  return {
    Type: 'AWS::IAM::Role',
    Properties: {
      RoleName: `rimac-demo-${name}`,
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      Policies: [
        {
          PolicyName: 'runtime',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              allow(['logs:CreateLogStream', 'logs:PutLogEvents'], {
                'Fn::Sub':
                  'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/rimac-demo-' +
                  name +
                  ':*',
              }),
              ...statements,
            ],
          },
        },
      ],
    },
  };
}

export function roles(cluster, secrets) {
  const publish = allow('sns:Publish', { Ref: 'Topic' });
  const decryptTopic = allow(['kms:GenerateDataKey', 'kms:Decrypt'], '*');
  decryptTopic.Condition = { StringEquals: { 'kms:ViaService': 'sns.us-east-1.amazonaws.com' } };
  const outbox = allow(
    ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
    [arn('Outbox'), { 'Fn::Join': ['', [arn('Outbox'), '/index/due']] }],
  );
  const consume = (queue) =>
    allow(['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'], arn(queue));
  const resources = {
    AppointmentRole: role('appointment', [
      allow(
        [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:Query',
          'dynamodb:ConditionCheckItem',
        ],
        [arn('Appointments'), arn('Keys'), arn('Outbox')],
      ),
      outbox,
      publish,
      decryptTopic,
      consume('ConfirmationQueue'),
    ]),
    RetryRole: role('retry', [outbox, publish, decryptTopic]),
  };
  for (const country of ['PE', 'CL']) {
    resources[`WorkerRole${country}`] = role(`appointment_${country.toLowerCase()}`, [
      consume(`Queue${country}`),
      allow(
        [
          'rds-data:ExecuteStatement',
          'rds-data:BeginTransaction',
          'rds-data:CommitTransaction',
          'rds-data:RollbackTransaction',
        ],
        cluster,
      ),
      allow('secretsmanager:GetSecretValue', secrets[country]),
      allow('events:PutEvents', arn('Bus')),
    ]);
  }
  return resources;
}
