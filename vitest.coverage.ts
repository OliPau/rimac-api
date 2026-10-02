import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.integration.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: [['text', { skipFull: false }], 'json', 'json-summary', 'html', 'lcov'],
      thresholds: { perFile: true, lines: 100, branches: 100 },
    },
  },
});
