import { readFile } from 'node:fs/promises';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { DataApi } from '../packages/adapters/src/data-api.js';

const config = { region: process.env.AWS_REGION ?? 'us-east-1' };
const stacks = new CloudFormationClient(config);
const secrets = new SecretsManagerClient(config);
const result = await stacks.send(new DescribeStacksCommand({ StackName: 'rimac-data-demo' }));
const outputs = new Map(
  result.Stacks?.[0]?.Outputs?.map((output) => [output.OutputKey, output.OutputValue]),
);

function output(name: string): string {
  const value = outputs.get(name);
  if (!value) {
    throw new Error(`Missing stack output: ${name}`);
  }
  return value;
}

const client = new RDSDataClient({ ...config, maxAttempts: 3 });
const admin = new DataApi(client, {
  resourceArn: output('ClusterArn'),
  secretArn: output('AdminSecret'),
  database: 'appointments_pe',
});
const migration = await readFile('infra/migrations/001.sql', 'utf8');

for (const country of ['PE', 'CL']) {
  const database = `appointments_${country.toLowerCase()}`;
  const username = `rimac_${country.toLowerCase()}`;
  const secretArn = output(`Secret${country}`);
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const credentials: unknown = JSON.parse(secret.SecretString ?? '{}');
  if (
    !credentials ||
    typeof credentials !== 'object' ||
    !('password' in credentials) ||
    typeof credentials.password !== 'string' ||
    !/^[a-zA-Z0-9]{32}$/.test(credentials.password)
  ) {
    throw new Error('Invalid generated database credential');
  }
  await admin.execute(`CREATE DATABASE IF NOT EXISTS ${database}`);
  // MySQL account DDL cannot use prepared parameters; only validated generated credentials enter it.
  await admin.execute(
    `CREATE USER IF NOT EXISTS '${username}'@'%' IDENTIFIED BY '${credentials.password}'`,
  );
  const migrationDb = new DataApi(client, {
    resourceArn: output('ClusterArn'),
    secretArn: output('AdminSecret'),
    database,
  });
  for (const sql of migration.split(';').filter((statement) => statement.trim())) {
    await migrationDb.execute(sql);
  }
  await admin.execute(`GRANT SELECT, INSERT, UPDATE ON ${database}.* TO '${username}'@'%'`);
  console.log(`Migrated ${database}`);
}
