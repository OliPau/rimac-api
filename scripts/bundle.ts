import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.local/bundle', { recursive: true });
const result = await build({
  entryPoints: {
    'apps/api/src/appointment': 'apps/api/src/appointment.ts',
    'apps/api/src/worker': 'apps/api/src/worker.ts',
    'apps/api/src/retry': 'apps/api/src/retry.ts',
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
