import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { expect, test } from 'vitest';
import { entries, inspectPackages, packageLocal } from '../scripts/packages.js';
import { swaggerAssets } from '#infrastructure/http/swagger/assets';

test('preserves existing archive paths and restricts Swagger to its static manifest', async () => {
  await mkdir('.local', { recursive: true });
  const directory = await mkdtemp('.local/package-test-');
  const source = join(directory, 'source');
  const output = join(directory, 'output');
  await mkdir(join(source, 'src/handlers'), { recursive: true });
  for (const entry of new Set(Object.values(entries))) {
    await writeFile(join(source, `src/handlers/${entry}.cjs`), 'exports.handler = async () => {};');
  }
  await mkdir(join(source, 'static/swagger'), { recursive: true });
  for (const asset of swaggerAssets) {
    await writeFile(join(source, asset.file), '{}');
  }
  await packageLocal(source, output);
  await expect(inspectPackages(output)).resolves.toBeUndefined();
  const swaggerFiles: Record<string, Uint8Array> = {
    'src/handlers/swagger.cjs': Buffer.from('exports.handler = 1;'),
    ...Object.fromEntries(swaggerAssets.map(({ file }) => [file, Buffer.from('{}')])),
  };
  for (const files of [
    { 'src/handlers/swagger.cjs': swaggerFiles['src/handlers/swagger.cjs']! },
    { ...swaggerFiles, 'static/swagger/openapi.json': Buffer.from('{invalid') },
    { ...swaggerFiles, 'static/swagger/.env': Buffer.from('private') },
    { ...swaggerFiles, 'static/swagger/swagger-ui-bundle.js.map': Buffer.from('{}') },
  ]) {
    await writeFile(join(output, 'swagger.zip'), zipSync(files));
    await expect(inspectPackages(output)).rejects.toThrow();
  }
  await packageLocal(source, output);
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
  await expect(inspectPackages(output)).rejects.toThrow('exactly the five');
});
