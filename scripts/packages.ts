import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { unzipSync, zipSync } from 'fflate';

export const entries = {
  appointment: 'appointment',
  appointment_pe: 'worker',
  appointment_cl: 'worker',
  retry: 'retry',
} as const;
const maximumEntryBytes = 10 * 1024 * 1024;

export async function packageLocal(
  source = '.local/bundle',
  destination = '.local/artifacts',
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const [name, entry] of Object.entries(entries)) {
    const path = `src/handlers/${entry}.cjs`;
    const content = await readFile(join(source, path));
    await writeFile(join(destination, `${name}.zip`), zipSync({ [path]: content }, { level: 6 }));
    console.log(`Packaged ${name}`);
  }
}

export async function inspectPackages(directory: string): Promise<void> {
  const archives = (await readdir(directory)).filter((name) => name.endsWith('.zip')).sort();
  const expected = Object.keys(entries)
    .map((name) => `${name}.zip`)
    .sort();
  if (JSON.stringify(archives) !== JSON.stringify(expected)) {
    throw new Error('Expected exactly the four Lambda archives');
  }
  for (const [name, entry] of Object.entries(entries)) {
    const path = `src/handlers/${entry}.cjs`;
    const compressed = await readFile(join(directory, `${name}.zip`));
    if (compressed.byteLength > maximumEntryBytes) {
      throw new Error(`Oversized archive: ${name}`);
    }
    let count = 0;
    const files = unzipSync(compressed, {
      filter(file) {
        count++;
        if (
          count !== 1 ||
          file.name !== path ||
          file.originalSize === 0 ||
          file.originalSize > maximumEntryBytes
        ) {
          throw new Error(`Unexpected package entry: ${name}/${file.name}`);
        }
        return true;
      },
    });
    const content = files[path];
    if (count !== 1 || !content?.byteLength) {
      throw new Error(`Missing executable code: ${name}`);
    }
    new Script(new TextDecoder('utf-8', { fatal: true }).decode(content), { filename: path });
    console.log(`${name}.zip: 1 file, ${content.byteLength} bytes, clean`);
  }
}
