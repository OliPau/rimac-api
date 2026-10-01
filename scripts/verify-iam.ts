import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { IAMClient, SimulatePrincipalPolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const config = { region: 'us-east-1' };
const iam = new IAMClient(config);
const stack = await new CloudFormationClient(config).send(
  new DescribeStacksCommand({ StackName: 'rimac-data-demo' }),
);
const outputs = new Map(
  stack.Stacks?.[0]?.Outputs?.map((item) => [item.OutputKey, item.OutputValue]),
);
for (const country of ['PE', 'CL']) {
  const role = await iam.send(
    new GetRoleCommand({ RoleName: `rimac-demo-appointment_${country.toLowerCase()}` }),
  );
  const own = outputs.get(`Secret${country}`);
  const other = outputs.get(country === 'PE' ? 'SecretCL' : 'SecretPE');
  assert.ok(role.Role?.Arn && own && other);
  const result = await iam.send(
    new SimulatePrincipalPolicyCommand({
      PolicySourceArn: role.Role.Arn,
      ActionNames: ['secretsmanager:GetSecretValue'],
      ResourceArns: [own, other],
    }),
  );
  assert.equal(
    result.EvaluationResults?.find((item) => item.EvalResourceName === own)?.EvalDecision,
    'allowed',
  );
  assert.equal(
    result.EvaluationResults?.find((item) => item.EvalResourceName === other)?.EvalDecision,
    'implicitDeny',
  );
  console.log(`${country}: own secret allowed, other country secret denied`);
}
await writeFile(
  'delivery/iam.json',
  JSON.stringify({ testedAt: new Date().toISOString(), isolatedSecrets: true }, null, 2),
);
