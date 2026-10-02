import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { z } from 'zod';
import { project, resource } from '../infra/config.js';

const config = { region: project.region };
const documents = DynamoDBDocumentClient.from(new DynamoDBClient(config));
const lambda = new LambdaClient(config);
const table = resource('outbox');
const oldest = { id: randomUUID(), age: 120, dueIn: 1800 };
const newest = { id: randomUUID(), age: 10, dueIn: 900 };
const records = [oldest, newest];
const started = Date.now();
const log = z.object({ message: z.literal('OutboxRetry'), pendingAge: z.number() });

try {
  for (const record of records) {
    await documents.send(
      new PutCommand({
        TableName: table,
        Item: {
          id: record.id,
          state: 'pending',
          pendingSince: started - record.age * 1000,
          dueAt: Math.floor(started / 1000) + record.dueIn,
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  }
  let observed: number | undefined;
  for (let attempt = 0; attempt < 10; attempt++) {
    await delay(2000);
    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: resource('retry'),
        LogType: 'Tail',
        Payload: Buffer.from('{}'),
      }),
    );
    assert.equal(result.FunctionError, undefined);
    assert.ok(result.LogResult);
    const lines = Buffer.from(result.LogResult, 'base64').toString().split('\n');
    for (const line of lines.filter((value) => value.startsWith('{'))) {
      const parsed = log.safeParse(JSON.parse(line));
      if (parsed.success) {
        observed = parsed.data.pendingAge;
      }
    }
    if (observed !== undefined && observed >= oldest.age) {
      break;
    }
  }
  assert.ok(observed !== undefined && observed >= oldest.age);
  assert.ok(observed <= oldest.age + Math.ceil((Date.now() - started) / 1000));
  await writeFile(
    'delivery/pending-age.json',
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        function: resource('retry'),
        observedSeconds: observed,
        oldestAgeSeconds: oldest.age,
        oldestRetryOccursAfterNewest: true,
        includesFutureRetries: true,
      },
      null,
      2,
    ),
  );
  console.log(`Deployed retry Lambda measured the oldest pending publication: ${observed}s`);
} finally {
  for (const record of records) {
    await documents.send(new DeleteCommand({ TableName: table, Key: { id: record.id } }));
  }
}
