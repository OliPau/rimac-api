import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

const project = 'OliPau_rimac-api';
const token = process.env.SONAR_TOKEN;
const revision = process.env.GITHUB_SHA;
assert.ok(token && revision, 'Missing Sonar analysis context');
async function query(path: string, parameters: Record<string, string>): Promise<unknown> {
  const url = new URL(path, 'https://sonarcloud.io');
  url.search = new URLSearchParams(parameters).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(response.ok, `Sonar API failed: ${response.status}`);
  return response.json();
}
const analyses = z
  .object({ analyses: z.array(z.object({ key: z.string(), revision: z.string().optional() })) })
  .parse(await query('/api/project_analyses/search', { project, ps: '1' }));
const analysis = analyses.analyses[0];
assert.ok(analysis && analysis.revision === revision, 'Sonar must analyze the deployment revision');
const gate = z
  .object({ projectStatus: z.object({ status: z.string() }) })
  .parse(await query('/api/qualitygates/project_status', { analysisId: analysis.key }));
assert.equal(gate.projectStatus.status, 'OK');
const issueSchema = z.object({
  key: z.string(),
  rule: z.string(),
  component: z.string(),
  message: z.string(),
  line: z.number().optional(),
});
const pageSchema = z.object({ total: z.number(), issues: z.array(issueSchema) });
const issues: z.infer<typeof issueSchema>[] = [];
for (let page = 1; ; page++) {
  const result = pageSchema.parse(
    await query('/api/issues/search', {
      componentKeys: project,
      resolved: 'false',
      types: 'VULNERABILITY,BUG,CODE_SMELL',
      ps: '500',
      p: String(page),
    }),
  );
  issues.push(...result.issues);
  if (issues.length >= result.total) {
    break;
  }
}
const reviews = z
  .array(
    z.object({
      key: z.string(),
      rule: z.string(),
      component: z.string(),
      justification: z.string().min(30),
    }),
  )
  .parse(JSON.parse(await readFile('infra/security-context.json', 'utf8')));
const pending = issues.filter(
  (issue) =>
    !reviews.some(
      (review) =>
        review.key === issue.key &&
        review.rule === issue.rule &&
        review.component === issue.component,
    ),
);
await mkdir('delivery', { recursive: true });
await writeFile(
  'delivery/sonar-audit.json',
  JSON.stringify({ revision, analysis: analysis.key, gate, issues, reviews, pending }, null, 2),
);
console.log(
  JSON.stringify(
    { revision, total: issues.length, justified: issues.length - pending.length, pending },
    null,
    2,
  ),
);
assert.equal(pending.length, 0, 'Unreviewed findings remain in the full Sonar analysis');
