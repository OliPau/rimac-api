import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const command = process.argv[2] ?? 'package';
if (!['package', 'deploy', 'remove', 'print'].includes(command)) {
  throw new Error('Unsupported Serverless command');
}
if (command === 'deploy') {
  const client = new CloudFormationClient({ region: 'us-east-1' });
  const result = await client.send(new DescribeStacksCommand({ StackName: 'rimac-data-demo' }));
  process.env.AWS_ACCOUNT_ID = result.Stacks?.[0]?.StackId?.split(':')[4];
  const outputs = new Map(
    result.Stacks?.[0]?.Outputs?.map((item) => [item.OutputKey, item.OutputValue]),
  );
  for (const [name, key] of Object.entries({
    CLUSTER_ARN: 'ClusterArn',
    SECRET_PE: 'SecretPE',
    SECRET_CL: 'SecretCL',
  })) {
    const value = outputs.get(key);
    if (!value) {
      throw new Error(`Missing data output: ${key}`);
    }
    process.env[name] = value;
  }
}
const { default: config } = await import('../infra/service.js');
await writeFile('serverless.generated.json', JSON.stringify(config, null, 2));
const require = createRequire(import.meta.url);
if (command === 'package' || command === 'deploy') {
  await import('./bundle.js');
  for (const args of [
    ['scripts/package-local.py'],
    ['scripts/inspect-package.py', '.local/artifacts'],
  ]) {
    const result = spawnSync('python', args, { stdio: 'inherit' });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}
function run(args: string[]): void {
  const result = spawnSync(process.execPath, [require.resolve('serverless/run.js'), ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (command === 'deploy') {
  run(['package', '--config', 'serverless.generated.json']);
  run(['deploy', '--config', 'serverless.generated.json', '--package', '.serverless']);
} else {
  run([command, '--config', 'serverless.generated.json']);
}
