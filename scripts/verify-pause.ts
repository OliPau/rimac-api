import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { acceptance, appointment } from '../packages/contracts/src/index.js';
import { z } from 'zod';

const config = { region: 'us-east-1' };
const metrics = new CloudWatchClient(config);
let pausedAt: string | undefined;
const started = new Date();
for (let attempt = 0; attempt < 25; attempt++) {
  const result = await metrics.send(
    new GetMetricStatisticsCommand({
      Namespace: 'AWS/RDS',
      MetricName: 'ServerlessDatabaseCapacity',
      Dimensions: [{ Name: 'DBInstanceIdentifier', Value: 'rimac-demo-writer' }],
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
const stack = await new CloudFormationClient(config).send(
  new DescribeStacksCommand({ StackName: 'rimac-demo' }),
);
const endpoint = stack.Stacks?.[0]?.Outputs?.find(
  (item) => item.OutputKey === 'HttpApiUrl',
)?.OutputValue;
assert.ok(endpoint);
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
