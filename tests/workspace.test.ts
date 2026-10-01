import { expect, test } from 'vitest';

test('uses the supported runtime', () => {
  expect(Number(process.versions.node.split('.')[0])).toBe(24);
});
