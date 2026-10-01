import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.serverless/**', 'coverage/**', 'delivery/**', '.local/**'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    files: ['**/*.ts'],
  },
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@aws-sdk/*', 'zod', '**/adapters/**', '**/contracts/**'] },
      ],
    },
  },
);
