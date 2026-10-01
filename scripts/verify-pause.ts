import { stackOutputs } from './cloud.js';
import { project, resource, stacks } from '../infra/config.js';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { acceptance, appointment } from '../packages/contracts/src/index.js';
import { z } from 'zod';

const config = { region: project.region };
const metrics = new CloudWatchClient(config);
let pausedAt: string | undefined;
const started = new Date(Date.now() - 1000);
for (let attempt = 0; attempt < 25; attempt++) {
  const result = await metrics.send(
    new GetMetricStatisticsCommand({
      Namespace: 'AWS/RDS',
      MetricName: 'ServerlessDatabaseCapacity',
      Dimensions: [{ Name: 'DBInstanceIdentifier', Value: resource('writer') }],
      StartTime: started,
      EndTime: new Date(),
      Period: 60,
      Statistics: ['Average'],
    }),
  );
  const zero = result.Datapoints?.find((point) => point.Average === 0);
  if (zero?.Timestamp) {
    pausedAt = zero.Timestamp.toISOString();
    break;
  }
  console.log('Waiting for a new zero-ACU metric; no SQL polling');
  await delay(45000);
}
assert.ok(pausedAt, 'Aurora must reach zero ACUs without traffic');
const endpoint = (await stackOutputs(stacks.application)).get('HttpApiUrl');
const resumed = Date.now();
const response = await fetch(`${endpoint}/appointments`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ insuredId: '00999', scheduleId: Date.now(), countryISO: 'PE' }),
});
assert.equal(response.status, 202);
const accepted = acceptance.parse(await response.json());
const pageSchema = z.object({ items: z.array(appointment) });
for (let attempt = 0; attempt < 120; attempt++) {
  const page = pageSchema.parse(
    await (await fetch(`${endpoint}/appointments/00999?limit=100`)).json(),
  );
  if (
    page.items.find((item) => item.appointmentId === accepted.appointmentId)?.status === 'completed'
  ) {
    const resumeMilliseconds = Date.now() - resumed;
    await writeFile(
      'delivery/pause.json',
      JSON.stringify(
        { pausedAt, resumedAt: new Date().toISOString(), resumeMilliseconds },
        null,
        2,
      ),
    );
    console.log(`Aurora paused and resumed processing in ${resumeMilliseconds} ms`);
    process.exit(0);
  }
  await delay(5000);
}
throw new Error('Processing did not resume');
