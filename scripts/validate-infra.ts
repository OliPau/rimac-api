import { mkdir, writeFile } from 'node:fs/promises';
import { service } from '../infra/service.js';
import { localDeployment, resource } from '../infra/config.js';

const config = service(localDeployment());

await mkdir('.local', { recursive: true });
await writeFile(
  '.local/resources.json',
  JSON.stringify(
    {
      AWSTemplateFormatVersion: '2010-09-09',
      Resources: {
        ...config.resources.Resources,
        RetryLogGroup: {
          Type: 'AWS::Logs::LogGroup',
          Properties: { LogGroupName: `/aws/lambda/${resource('retry')}` },
        },
        AppointmentLogGroup: { Type: 'AWS::Logs::LogGroup' },
        SwaggerLogGroup: { Type: 'AWS::Logs::LogGroup' },
        AppointmentUnderscorepeLogGroup: { Type: 'AWS::Logs::LogGroup' },
        AppointmentUnderscoreclLogGroup: { Type: 'AWS::Logs::LogGroup' },
      },
    },
    null,
    2,
  ),
);
console.log('Generated application resources for CloudFormation validation');
