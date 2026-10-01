import { messaging } from './messaging.js';
import { tables } from './tables.js';
import { roles } from './roles.js';
import { monitoring } from './monitoring.js';
import type { AWS, AwsCfGetAtt } from '@serverless/typescript';
import type { Functions } from './types.js';

import { project, resource, type Deployment } from './config.js';

export function service({ cluster, secrets, account }: Deployment) {
  const arn = (name: string): AwsCfGetAtt => ({ 'Fn::GetAtt': [name, 'Arn'] });
  const environment = {
    APPOINTMENTS_TABLE: { Ref: 'Appointments' },
    KEYS_TABLE: { Ref: 'Keys' },
    OUTBOX_TABLE: { Ref: 'Outbox' },
    TOPIC_ARN: { Ref: 'Topic' },
  };
  const functions: Functions = {
    appointment: {
      handler: 'apps/api/src/appointment.handler',
      package: { artifact: '.local/artifacts/appointment.zip' },
      timeout: 15,
      reservedConcurrency: 5,
      role: arn('AppointmentRole'),
      environment,
      events: [
        { httpApi: { method: 'POST', path: '/appointments' } },
        { httpApi: { method: 'GET', path: '/appointments/{insuredId}' } },
        {
          sqs: {
            arn: arn('ConfirmationQueue'),
            batchSize: 5,
            functionResponseType: 'ReportBatchItemFailures',
            maximumConcurrency: 2,
          },
        },
      ],
    },
    retry: {
      handler: 'apps/api/src/retry.handler',
      package: { artifact: '.local/artifacts/retry.zip' },
      timeout: 45,
      reservedConcurrency: 1,
      role: arn('RetryRole'),
      environment,
      events: [{ schedule: 'rate(1 minute)' }],
    },
  };
  for (const country of ['PE', 'CL'] as const) {
    functions[`appointment_${country.toLowerCase()}`] = {
      handler: 'apps/api/src/worker.handler',
      package: { artifact: `.local/artifacts/appointment_${country.toLowerCase()}.zip` },
      timeout: 60,
      reservedConcurrency: 2,
      role: arn(`WorkerRole${country}`),
      environment: {
        COUNTRY: country,
        CLUSTER_ARN: cluster,
        SECRET_ARN: secrets[country],
        DATABASE: `appointments_${country.toLowerCase()}`,
        EVENT_BUS: { Ref: 'Bus' },
      },
      events: [
        {
          sqs: {
            arn: arn(`Queue${country}`),
            batchSize: 5,
            functionResponseType: 'ReportBatchItemFailures',
            maximumConcurrency: 2,
          },
        },
      ],
    };
  }

  return {
    service: project.service,
    frameworkVersion: '4',
    configValidationMode: 'error',
    provider: {
      name: 'aws',
      runtime: 'nodejs24.x',
      region: project.region,
      stage: project.stage,
      memorySize: 256,
      deploymentBucket: {
        name: resource(`artifacts-${account}`),
        blockPublicAccess: true,
        serverSideEncryption: 'AES256',
      },
      logRetentionInDays: 7,
      stackTags: { Project: project.service, Environment: project.stage },
      tags: { Project: project.service, Environment: project.stage },
      httpApi: { cors: false },
    },
    build: { esbuild: false },
    package: { individually: true, patterns: ['!**', '!.env*'] },
    functions,
    resources: {
      Resources: { ...tables(), ...messaging(), ...roles(cluster, secrets), ...monitoring() },
      extensions: {
        HttpApiStage: {
          Properties: {
            DefaultRouteSettings: { ThrottlingBurstLimit: 10, ThrottlingRateLimit: 5 },
          },
        },
      },
      Outputs: {
        TopicArn: { Value: { Ref: 'Topic' } },
        EventBus: { Value: { Ref: 'Bus' } },
      },
    },
  } satisfies AWS;
}
