import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { DataApi } from '../packages/adapters/src/data-api.js';
import { z } from 'zod';

const evidence = z
  .object({ insuredId: z.string(), scheduleId: z.number() })
  .parse(JSON.parse(await readFile('delivery/smoke.json', 'utf8')));
const config = { region: 'us-east-1' };
const result = await new CloudFormationClient(config).send(
  new DescribeStacksCommand({ StackName: 'rimac-data-demo' }),
);
const outputs = new Map(
  result.Stacks?.[0]?.Outputs?.map((item) => [item.OutputKey, item.OutputValue]),
);
function output(key: string): string {
  const value = outputs.get(key);
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
}
for (const country of ['PE', 'CL']) {
  const database = new DataApi(new RDSDataClient(config), {
    resourceArn: output('ClusterArn'),
    secretArn: output(`Secret${country}`),
    database: `appointments_${country.toLowerCase()}`,
  });
  const rows = await database.execute(
    'SELECT insured_id, country_iso FROM appointments WHERE insured_id = :insured AND schedule_id = :schedule',
    { insured: evidence.insuredId, schedule: evidence.scheduleId },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.insured_id, evidence.insuredId);
  assert.equal(rows[0]?.country_iso, country);
  const other = country === 'PE' ? 'cl' : 'pe';
  await assert.rejects(
    database.execute(`SELECT id FROM appointments_${other}.appointments LIMIT 1`),
    /denied/i,
  );
  console.log(`${country}: correct database, one row, cross-country SQL access denied`);
}
await writeFile(
  'delivery/sql.json',
  JSON.stringify(
    { testedAt: new Date().toISOString(), countryIsolation: true, uniqueRows: true },
    null,
    2,
  ),
);
