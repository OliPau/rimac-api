import { stackOutputs } from './cloud.js';
import { project, stacks } from '../infra/config.js';
import { readFile } from 'node:fs/promises';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { DataApi } from '#infrastructure/persistence/mysql/data-api';

const config = { region: project.region };
const secrets = new SecretsManagerClient(config);
const outputs = await stackOutputs(stacks.data);

const client = new RDSDataClient({ ...config, maxAttempts: 3 });
const admin = new DataApi(client, {
  resourceArn: outputs.get('ClusterArn'),
  secretArn: outputs.get('AdminSecret'),
  database: 'appointments_pe',
});
const migration = await readFile('infra/migrations/001.sql', 'utf8');

for (const country of ['PE', 'CL']) {
  const database = `appointments_${country.toLowerCase()}`;
  const username = `rimac_${country.toLowerCase()}`;
  const secretArn = outputs.get(`Secret${country}`);
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
    resourceArn: outputs.get('ClusterArn'),
    secretArn: outputs.get('AdminSecret'),
    database,
  });
  for (const sql of migration.split(';').filter((statement) => statement.trim())) {
    await migrationDb.execute(sql);
  }
  await admin.execute(`GRANT SELECT, INSERT, UPDATE ON ${database}.* TO '${username}'@'%'`);
  console.log(`Migrated ${database}`);
}
