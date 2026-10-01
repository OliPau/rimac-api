import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const metric = z.object({ total: z.number(), covered: z.number() });
const summary = z.record(z.string(), z.object({ lines: metric, branches: metric }));
const report = summary.parse(JSON.parse(await readFile('coverage/coverage-summary.json', 'utf8')));
let files = 0;
for await (const file of glob(['apps/api/src/**/*.ts', 'packages/*/src/**/*.ts'])) {
  const entry = report[resolve(file)];
  assert.ok(entry, `Coverage omitted backend file: ${file}`);
  assert.equal(entry.lines.covered, entry.lines.total, `Uncovered lines: ${file}`);
  assert.equal(entry.branches.covered, entry.branches.total, `Uncovered branches: ${file}`);
  files++;
}
assert.ok(files > 0, 'No backend sources found');
console.log(
  `Verified all ${files} backend sources are present with complete line and branch coverage`,
);
