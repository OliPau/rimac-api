import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';

const token = process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const revision = process.env.GITHUB_SHA;
assert.ok(token && repository && revision, 'Missing GitHub analysis verification context');
const runSchema = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number(),
      head_sha: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      html_url: z.string(),
    }),
  ),
});
const verified = [];
for (const workflow of ['ci.yml', 'security.yml']) {
  const url = new URL(
    `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs`,
  );
  url.searchParams.set('head_sha', revision);
  url.searchParams.set('event', 'push');
  url.searchParams.set('per_page', '1');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  assert.ok(response.ok, `Cannot verify ${workflow}: ${response.status}`);
  const run = runSchema.parse(await response.json()).workflow_runs[0];
  assert.ok(
    run && run.head_sha === revision && run.status === 'completed' && run.conclusion === 'success',
    `${workflow} must have completed successfully for ${revision}`,
  );
  verified.push({ workflow, revision, url: run.html_url });
}
await mkdir('delivery', { recursive: true });
await writeFile('delivery/analysis-verification.json', JSON.stringify(verified, null, 2));
console.log(`Both security analyses passed for ${revision}`);
