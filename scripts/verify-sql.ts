import { stackOutputs } from './cloud.js';
import { project, stacks } from '../infra/config.js';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { DataApi } from '#infrastructure/persistence/mysql/data-api';
import { z } from 'zod';

const evidence = z
  .object({ insuredId: z.string(), scheduleId: z.number() })
  .parse(JSON.parse(await readFile('delivery/smoke.json', 'utf8')));
const config = { region: project.region };
const outputs = await stackOutputs(stacks.data);
for (const country of ['PE', 'CL']) {
  const database = new DataApi(new RDSDataClient(config), {
    resourceArn: outputs.get('ClusterArn'),
    secretArn: outputs.get(`Secret${country}`),
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
