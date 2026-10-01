import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { acceptance, appointment } from '../packages/contracts/src/index.js';
import { z } from 'zod';

const client = new CloudFormationClient({ region: 'us-east-1' });
const stack = await client.send(new DescribeStacksCommand({ StackName: 'rimac-demo' }));
const endpoint =
  process.env.API_URL ??
  stack.Stacks?.[0]?.Outputs?.find((item) => item.OutputKey === 'HttpApiUrl')?.OutputValue;
if (!endpoint) {
  throw new Error('Missing API endpoint');
}
const url = endpoint.replace(/\/$/, '');
const insuredId = `00${randomInt(100, 999)}`;
const scheduleId = Date.now();
const page = z.object({ items: z.array(appointment), cursor: z.string().optional() });

async function call(path: string, body?: unknown, key?: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${url}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status !== 429 || attempt >= 6) {
      return response;
    }
    await delay(1000 + Math.random() * 1000);
  }
}

const ids: string[] = [];
for (const countryISO of ['PE', 'CL']) {
  const body = { insuredId, scheduleId, countryISO };
  const key = randomUUID();
  const response = await call('/appointments', body, key);
  assert.equal(response.status, 202);
  const accepted = acceptance.parse(await response.json());
  ids.push(accepted.appointmentId);
  const repeated = await Promise.all(
    Array.from({ length: 8 }, async (_, index) => {
      const result = await call('/appointments', body, index % 2 ? key : randomUUID());
      assert.equal(result.status, 202);
      return acceptance.parse(await result.json());
    }),
  );
  for (const result of repeated) {
    assert.deepEqual(result, accepted);
  }
  assert.equal(
    (await call('/appointments', { ...body, scheduleId: scheduleId + 1 }, key)).status,
    409,
  );
  console.log(`${countryISO}: acceptance, concurrent deduplication and conflict verified`);
}

let completed = false;
for (let attempt = 0; attempt < 120; attempt++) {
  const response = await call(`/appointments/${insuredId}`);
  assert.equal(response.status, 200);
  const current = page.parse(await response.json());
  const ours = current.items.filter((item) => ids.includes(item.appointmentId));
  if (ours.length === 2 && ours.every((item) => item.status === 'completed')) {
    completed = true;
    break;
  }
  if (attempt % 6 === 0) {
    console.log('Waiting for country processing...');
  }
  await delay(5000);
}
assert.ok(completed, 'Both countries must reach completed');
const first = page.parse(await (await call(`/appointments/${insuredId}?limit=1`)).json());
assert.equal(first.items.length, 1);
assert.ok(first.cursor);
const next = page.parse(
  await (await call(`/appointments/${insuredId}?limit=1&cursor=${first.cursor}`)).json(),
);
assert.notEqual(first.items[0]?.appointmentId, next.items[0]?.appointmentId);
assert.equal((await call(`/appointments/99999?cursor=${first.cursor}`)).status, 400);
assert.equal((await call(`/appointments/${insuredId}?limit=101`)).status, 400);
assert.equal(
  (await call('/appointments', { insuredId: '123', scheduleId: 0, countryISO: 'AR' })).status,
  400,
);
assert.deepEqual(page.parse(await (await call('/appointments/99998')).json()).items, []);
await mkdir('delivery', { recursive: true });
await writeFile(
  'delivery/smoke.json',
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      endpoint: url,
      insuredId,
      scheduleId,
      appointmentIds: ids,
      checks: [
        'PE completed',
        'CL completed',
        'leading zeroes',
        'concurrent deduplication',
        '409 conflict',
        'pagination',
        'cursor binding',
        'validation',
        'empty list',
      ],
    },
    null,
    2,
  ),
);
console.log(`Smoke checks passed: ${url}`);
