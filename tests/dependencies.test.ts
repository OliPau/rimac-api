import { spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';
import { expect, test } from 'vitest';

test('URI compatibility and regression inputs finish in an isolated process', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-uri.ts'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

test('ESLint still rejects configured rule violations', { timeout: 60_000 }, async () => {
  const eslint = new ESLint();
  const result = await eslint.lintText('const unused: any = 1;\nif (true) console.log("bad");\n', {
    filePath: 'scripts/verify-uri.ts',
  });
  const rules = result.flatMap(({ messages }) => messages.map(({ ruleId }) => ruleId));
  expect(rules).toContain('@typescript-eslint/no-explicit-any');
  expect(rules).toContain('@typescript-eslint/no-unused-vars');
  expect(rules).toContain('curly');
});
