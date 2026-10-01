import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { DataApi } from '../packages/adapters/src/data-api.js';
import { MysqlStore } from '../packages/adapters/src/sql.js';
import type { Event } from '../packages/core/src/index.js';

const config = { region: 'us-east-1' };
const result = await new CloudFormationClient(config).send(
  new DescribeStacksCommand({ StackName: 'rimac-data-demo' }),
);
const outputs = new Map(
  result.Stacks?.[0]?.Outputs?.map((item) => [item.OutputKey, item.OutputValue]),
);
const resourceArn = outputs.get('ClusterArn');
assert.ok(resourceArn);
for (const countryISO of ['PE', 'CL'] as const) {
  const secretArn = outputs.get(`Secret${countryISO}`);
  assert.ok(secretArn);
  const database: DataApi = new DataApi(new RDSDataClient(config), {
    resourceArn,
    secretArn,
    database: `appointments_${countryISO.toLowerCase()}`,
  });
  const store: MysqlStore = new MysqlStore(database);
  const event: Event = {
    version: 1,
    type: 'appointment.requested',
    countryISO,
    insuredId: '00001',
    scheduleId: Date.now(),
    eventId: randomUUID(),
    appointmentId: randomUUID(),
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
  };
  const [first, repeated] = await Promise.all([store.save(event), store.save(event)]);
  assert.deepEqual(first, repeated);
  assert.equal(first.published, false);
  await store.published(first.confirmation.eventId);
  assert.equal((await store.save(event)).published, true);
  const other = countryISO === 'PE' ? 'cl' : 'pe';
  await assert.rejects(
    database.execute(`SELECT id FROM appointments_${other}.appointments LIMIT 1`),
    /denied/i,
  );
  console.log(
    `${countryISO}: Data API transactions, concurrent duplicates and SQL isolation verified`,
  );
}
await writeFile(
  'delivery/data-api.json',
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      transactions: true,
      duplicateRecovery: true,
      sqlIsolation: true,
    },
    null,
    2,
  ),
);
