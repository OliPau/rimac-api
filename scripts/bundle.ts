import { build } from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { openapi } from '#infrastructure/http/swagger/openapi';

await mkdir('.local/bundle', { recursive: true });
const result = await build({
  entryPoints: {
    'src/handlers/appointment': 'src/handlers/appointment.ts',
    'src/handlers/worker': 'src/handlers/worker.ts',
    'src/handlers/retry': 'src/handlers/retry.ts',
    'src/handlers/swagger': 'src/handlers/swagger.ts',
  },
  outdir: '.local/bundle',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  metafile: true,
});
await writeFile('.local/bundle/metafile.json', JSON.stringify(result.metafile, null, 2));
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  if (output.imports.some((entry) => !entry.external)) {
    throw new Error(`Unexpected runtime file dependency: ${file}`);
  }
  console.log(`${file}: ${output.bytes} bytes`);
}

const staticDirectory = '.local/bundle/static/swagger';
await mkdir(staticDirectory, { recursive: true });
const require = createRequire(import.meta.url);
const swaggerDirectory = dirname(require.resolve('swagger-ui-dist/package.json'));
for (const name of ['swagger-ui.css', 'swagger-ui-bundle.js']) {
  await copyFile(join(swaggerDirectory, name), join(staticDirectory, name));
}
await copyFile('src/infrastructure/http/swagger/index.html', join(staticDirectory, 'index.html'));
await writeFile(join(staticDirectory, 'openapi.json'), JSON.stringify(openapi()));
await build({
  entryPoints: ['src/infrastructure/http/swagger/initializer.ts'],
  outfile: join(staticDirectory, 'initializer.js'),
  bundle: true,
  platform: 'browser',
  target: 'es2023',
  format: 'iife',
});
