import { mkdir, writeFile } from 'node:fs/promises';
import service from '../infra/service.js';

await mkdir('.local', { recursive: true });
await writeFile(
  '.local/resources.json',
  JSON.stringify(
    {
      AWSTemplateFormatVersion: '2010-09-09',
      Resources: {
        ...service.resources.Resources,
        RetryLogGroup: {
          Type: 'AWS::Logs::LogGroup',
          Properties: { LogGroupName: '/aws/lambda/rimac-demo-retry' },
        },
      },
    },
    null,
    2,
  ),
);
console.log('Generated application resources for CloudFormation validation');
