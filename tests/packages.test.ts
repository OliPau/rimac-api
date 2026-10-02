import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { expect, test } from 'vitest';
import { entries, inspectPackages, packageLocal } from '../scripts/packages.js';

test('preserves four archive names and paths and rejects unexpected or invalid contents', async () => {
  await mkdir('.local', { recursive: true });
  const directory = await mkdtemp('.local/package-test-');
  const source = join(directory, 'source');
  const output = join(directory, 'output');
  await mkdir(join(source, 'src/handlers'), { recursive: true });
  for (const entry of new Set(Object.values(entries))) {
    await writeFile(join(source, `src/handlers/${entry}.cjs`), 'exports.handler = async () => {};');
  }
  await packageLocal(source, output);
  await expect(inspectPackages(output)).resolves.toBeUndefined();
  for (const files of [
    { '.env': new Uint8Array([1]) },
    { '../src/handlers/appointment.cjs': new Uint8Array([1]) },
    { 'src/handlers/appointment.cjs': Buffer.from('const = invalid;') },
    { 'src/handlers/appointment.cjs': new Uint8Array() },
    {
      'src/handlers/appointment.cjs': Buffer.from('exports.handler = 1;'),
      'tests/test.js': new Uint8Array([1]),
    },
  ]) {
    await writeFile(join(output, 'appointment.zip'), zipSync(files));
    await expect(inspectPackages(output)).rejects.toThrow();
  }
  await writeFile(join(output, 'extra.zip'), zipSync({}));
  await expect(inspectPackages(output)).rejects.toThrow('exactly the four');
});
