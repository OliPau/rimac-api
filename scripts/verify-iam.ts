import { stackOutputs } from './cloud.js';
import { project, resource, stacks } from '../infra/config.js';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { IAMClient, SimulatePrincipalPolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam';

const config = { region: project.region };
const iam = new IAMClient(config);
const outputs = await stackOutputs(stacks.data);
for (const country of ['PE', 'CL']) {
  const role = await iam.send(
    new GetRoleCommand({ RoleName: resource(`appointment_${country.toLowerCase()}`) }),
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
  const decisions = (result.EvaluationResults ?? []).flatMap(
    (evaluation) =>
      evaluation.ResourceSpecificResults?.map((resource) => ({
        resource: resource.EvalResourceName,
        decision: resource.EvalResourceDecision,
      })) ?? [{ resource: evaluation.EvalResourceName, decision: evaluation.EvalDecision }],
  );
  assert.equal(decisions.find((item) => item.resource === own)?.decision, 'allowed');
  assert.equal(decisions.find((item) => item.resource === other)?.decision, 'implicitDeny');
  console.log(`${country}: own secret allowed, other country secret denied`);
}
await writeFile(
  'delivery/iam.json',
  JSON.stringify({ testedAt: new Date().toISOString(), isolatedSecrets: true }, null, 2),
);
