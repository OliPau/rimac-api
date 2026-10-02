import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CloudFormationClient,
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
  GetTemplateCommand,
  ListStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';
import { infrastructureParameters, project, stacks } from '../infra/config.js';

const operation = process.argv[2];
const target = process.argv[3];
assert.ok(operation === 'plan' || operation === 'execute');
assert.ok(target === 'data' || target === 'cost' || target === 'github');
const client = new CloudFormationClient({ region: project.region });
const StackName = stacks[target];
const ChangeSetName = 'security-remediation';
await mkdir('delivery', { recursive: true });
if (operation === 'plan') {
  const stack = (await client.send(new DescribeStacksCommand({ StackName }))).Stacks?.[0];
  assert.ok(stack);
  const template = await client.send(new GetTemplateCommand({ StackName }));
  const resources = await client.send(new ListStackResourcesCommand({ StackName }));
  await writeFile(
    `delivery/${target}-before.json`,
    JSON.stringify({ stack, template, resources }, null, 2),
  );
  await client.send(
    new CreateChangeSetCommand({
      StackName,
      ChangeSetName,
      ChangeSetType: 'UPDATE',
      TemplateBody: await readFile(`infra/${target}.yml`, 'utf8'),
      Capabilities: ['CAPABILITY_NAMED_IAM'],
      Parameters: [
        ...(stack.Parameters ?? [])
          .filter(
            ({ ParameterKey }) =>
              !infrastructureParameters.some(
                (parameter) => parameter.ParameterKey === ParameterKey,
              ),
          )
          .map(({ ParameterKey }) => ({ ParameterKey, UsePreviousValue: true })),
        ...infrastructureParameters,
      ],
    }),
  );
}
let changes;
for (let attempt = 0; attempt < 60; attempt++) {
  changes = await client.send(new DescribeChangeSetCommand({ StackName, ChangeSetName }));
  if (changes.Status === 'CREATE_COMPLETE' || changes.Status === 'FAILED') {
    break;
  }
  await delay(2000);
}
assert.equal(changes?.Status, 'CREATE_COMPLETE', changes?.StatusReason);
assert.equal(changes.NextToken, undefined, 'Review all change-set pages before execution');
for (const change of changes.Changes ?? []) {
  const resource = change.ResourceChange;
  assert.ok(
    resource &&
      (resource.Action === 'Add' ||
        (resource.Action === 'Modify' && resource.Replacement === 'False')),
    `Unsafe resource change: ${JSON.stringify(resource)}`,
  );
}
await writeFile(`delivery/${target}-changes.json`, JSON.stringify(changes, null, 2));
console.log(
  JSON.stringify(
    changes.Changes?.map(({ ResourceChange }) => ({
      id: ResourceChange?.LogicalResourceId,
      action: ResourceChange?.Action,
      replacement: ResourceChange?.Replacement,
    })),
    null,
    2,
  ),
);
if (operation === 'execute') {
  await client.send(new ExecuteChangeSetCommand({ StackName, ChangeSetName }));
  console.log(`Executing ${StackName}`);
}
