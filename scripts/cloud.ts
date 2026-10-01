import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { deployment, project, stacks } from '../infra/config.js';

export async function stackOutputs(
  name: string,
  client = new CloudFormationClient({ region: project.region }),
) {
  const result = await client.send(new DescribeStacksCommand({ StackName: name }));
  const stack = result.Stacks?.[0];
  if (!stack?.StackId || !stack.Outputs) {
    throw new Error(`Missing stack outputs: ${name}`);
  }
  const values = new Map(stack.Outputs.map((item) => [item.OutputKey, item.OutputValue]));
  return {
    account: stack.StackId.split(':')[4],
    get(key: string): string {
      const value = values.get(key);
      if (!value) {
        throw new Error(`Missing stack output: ${name}/${key}`);
      }
      return value;
    },
  };
}

export async function deployedResources() {
  const outputs = await stackOutputs(stacks.data);
  return deployment.parse({
    account: outputs.account,
    cluster: outputs.get('ClusterArn'),
    secrets: { PE: outputs.get('SecretPE'), CL: outputs.get('SecretCL') },
  });
}
