import { expect, test } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { deployment, localDeployment, project, resource } from '../infra/config.js';
import { service } from '../infra/service.js';
import { stackOutputs } from '../scripts/cloud.js';

test('keeps deployed names and rejects local placeholders as deployment input', () => {
  const config = service(localDeployment());
  expect(config.provider.region).toBe('us-east-1');
  expect(config.provider.stage).toBe('demo');
  expect(resource('SQS_PE')).toBe('rimac-demo-SQS_PE');
  expect(config.resources.Resources.Appointments?.Properties.TableName).toBe(
    'rimac-demo-appointments',
  );
  expect(config.functions.appointment?.handler).toBe('src/handlers/appointment.handler');
  expect(config.functions.swagger?.environment).toEqual({
    SWAGGER_SECRET_ARN: localDeployment().swaggerSecret,
  });
  const swaggerRole = JSON.stringify(config.resources.Resources.SwaggerRole);
  expect(swaggerRole).toContain(localDeployment().swaggerSecret);
  expect(swaggerRole).toContain('secretsmanager:GetSecretValue');
  for (const action of ['dynamodb:', 'sns:', 'sqs:', 'rds-data:', 'PutSecretValue']) {
    expect(swaggerRole).not.toContain(action);
  }
  expect(deployment.safeParse(localDeployment()).success).toBe(false);
  expect(deployment.safeParse({}).success).toBe(false);
});

test('validates CloudFormation outputs before using deployment values', async () => {
  const client = new CloudFormationClient({ region: project.region });
  const mock = mockClient(client);
  try {
    mock.on(DescribeStacksCommand).resolves({});
    await expect(stackOutputs('data', client)).rejects.toThrow('Missing stack outputs');
    mock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: 'data',
          StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/data/id',
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [{ OutputKey: 'ClusterArn', OutputValue: 'cluster' }],
        },
      ],
    });
    const outputs = await stackOutputs('data', client);
    expect(outputs.account).toBe('123456789012');
    expect(outputs.get('ClusterArn')).toBe('cluster');
    expect(() => outputs.get('SecretPE')).toThrow('Missing stack output');
  } finally {
    mock.restore();
    client.destroy();
  }
});
