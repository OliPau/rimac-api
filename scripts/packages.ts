import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import { unzipSync, zipSync } from 'fflate';
import { swaggerAssets } from '#infrastructure/http/swagger/assets';

export const entries = {
  appointment: 'appointment',
  appointment_pe: 'worker',
  appointment_cl: 'worker',
  retry: 'retry',
  swagger: 'swagger',
} as const;
const maximumEntryBytes = 10 * 1024 * 1024;

export function packagePaths(name: string, entry: string): string[] {
  return [
    `src/handlers/${entry}.cjs`,
    ...(name === 'swagger' ? swaggerAssets.map((asset) => asset.file) : []),
  ];
}

export async function packageLocal(
  source = '.local/bundle',
  destination = '.local/artifacts',
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const [name, entry] of Object.entries(entries)) {
    const files: Record<string, Uint8Array> = {};
    for (const path of packagePaths(name, entry)) {
      files[path] = await readFile(join(source, path));
    }
    await writeFile(join(destination, `${name}.zip`), zipSync(files, { level: 6 }));
    console.log(`Packaged ${name}`);
  }
}

export async function inspectPackages(directory: string): Promise<void> {
  const archives = (await readdir(directory))
    .filter((name) => name.endsWith('.zip'))
    .sort((left, right) => left.localeCompare(right));
  const expected = Object.keys(entries)
    .map((name) => `${name}.zip`)
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(archives) !== JSON.stringify(expected)) {
    throw new Error('Expected exactly the five Lambda archives');
  }
  for (const [name, entry] of Object.entries(entries)) {
    const paths = packagePaths(name, entry);
    const compressed = await readFile(join(directory, `${name}.zip`));
    if (compressed.byteLength > maximumEntryBytes) {
      throw new Error(`Oversized archive: ${name}`);
    }
    const seen = new Set<string>();
    let totalBytes = 0;
    const files = unzipSync(compressed, {
      filter(file) {
        totalBytes += file.originalSize;
        if (
          seen.has(file.name) ||
          !paths.includes(file.name) ||
          file.originalSize === 0 ||
          totalBytes > maximumEntryBytes
        ) {
          throw new Error(`Unexpected package entry: ${name}/${file.name}`);
        }
        seen.add(file.name);
        return true;
      },
    });
    if (seen.size !== paths.length) {
      throw new Error(`Missing package entries: ${name}`);
    }
    for (const path of paths) {
      const content = files[path];
      if (!content?.byteLength) {
        throw new Error(`Missing package content: ${name}/${path}`);
      }
      const source = new TextDecoder('utf-8', { fatal: true }).decode(content);
      if (path.endsWith('.js') || path.endsWith('.cjs') || path.endsWith('.css')) {
        transformSync(source, { loader: path.endsWith('.css') ? 'css' : 'js', sourcefile: path });
      } else if (path.endsWith('.json')) {
        JSON.parse(source);
      }
    }
    console.log(`${name}.zip: ${seen.size} files, ${totalBytes} bytes, clean`);
  }
}
