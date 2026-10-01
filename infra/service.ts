import { messaging } from './messaging.js';
import { tables } from './tables.js';
import { roles } from './roles.js';
import { monitoring } from './monitoring.js';
import type { AWS, AwsCfGetAtt } from '@serverless/typescript';
import type { Country, Functions } from './types.js';

const cluster = process.env.CLUSTER_ARN ?? 'arn:aws:rds:us-east-1:000000000000:cluster:rimac-demo';
const secrets: Record<Country, string> = {
  PE:
    process.env.SECRET_PE ??
    'arn:aws:secretsmanager:us-east-1:000000000000:secret:rimac/demo/pe-local',
  CL:
    process.env.SECRET_CL ??
    'arn:aws:secretsmanager:us-east-1:000000000000:secret:rimac/demo/cl-local',
};
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

export default {
  service: 'rimac',
  frameworkVersion: '4',
  configValidationMode: 'error',
  provider: {
    name: 'aws',
    runtime: 'nodejs24.x',
    region: 'us-east-1',
    stage: 'demo',
    memorySize: 256,
    deploymentBucket: {
      name: `rimac-demo-artifacts-${process.env.AWS_ACCOUNT_ID ?? '000000000000'}`,
      blockPublicAccess: true,
      serverSideEncryption: 'AES256',
    },
    logRetentionInDays: 7,
    stackTags: { Project: 'rimac', Environment: 'demo' },
    tags: { Project: 'rimac', Environment: 'demo' },
    httpApi: { cors: false },
  },
  build: { esbuild: false },
  package: { individually: true, patterns: ['!**', '!.env*'] },
  functions,
  resources: {
    Resources: { ...tables(), ...messaging(), ...roles(cluster, secrets), ...monitoring() },
    extensions: {
      HttpApiStage: {
        Properties: { DefaultRouteSettings: { ThrottlingBurstLimit: 10, ThrottlingRateLimit: 5 } },
      },
    },
    Outputs: {
      TopicArn: { Value: { Ref: 'Topic' } },
      EventBus: { Value: { Ref: 'Bus' } },
    },
  },
} satisfies AWS;
