import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { project, resource } from '../infra/config.js';
import { backfillPending } from './backfill.js';

const table = resource('outbox');
const client = new DynamoDBClient({ region: project.region });
const description = await client.send(new DescribeTableCommand({ TableName: table }));
assert.equal(
  description.Table?.GlobalSecondaryIndexes?.find((index) => index.IndexName === 'pending-age')
    ?.IndexStatus,
  'ACTIVE',
);
const documents = DynamoDBDocumentClient.from(client);
let total = 0;
let cleanPasses = 0;
for (let attempt = 0; attempt < 20 && cleanPasses < 2; attempt++) {
  const updated = await backfillPending(documents, table);
  total += updated;
  cleanPasses = updated === 0 ? cleanPasses + 1 : 0;
  await delay(3000);
}
assert.equal(cleanPasses, 2, 'Pending migration did not converge');
await mkdir('delivery', { recursive: true });
await writeFile(
  'delivery/outbox-migration.json',
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      table,
      updated: total,
      cleanPasses,
    },
    null,
    2,
  ),
);
console.log(`Backfilled ${total} pending publications; repeated passes completed`);
