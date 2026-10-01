import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { deployedResources } from './cloud.js';
import { localDeployment } from '../infra/config.js';
import { service } from '../infra/service.js';

const command = process.argv[2] ?? 'package';
if (!['package', 'deploy', 'remove', 'print'].includes(command)) {
  throw new Error('Unsupported Serverless command');
}
const resources = ['package', 'print'].includes(command)
  ? localDeployment()
  : await deployedResources();
const config = service(resources);
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
