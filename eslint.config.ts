import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.serverless/**', 'coverage/**', 'delivery/**', '.local/**'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  { rules: { curly: ['error', 'all'] } },
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
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@aws-sdk/*',
            '@aws-lambda-powertools/*',
            'aws-lambda',
            'zod',
            '#application',
            '#application/*',
            '#infrastructure/*',
            '**/application/**',
            '**/infrastructure/**',
            '**/composition/**',
            '**/handlers/**',
            '**/infra/**',
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@aws-sdk/*',
            '@aws-lambda-powertools/*',
            'aws-lambda',
            'zod',
            '#infrastructure/*',
            '**/infrastructure/**',
            '**/composition/**',
            '**/handlers/**',
            '**/infra/**',
          ],
        },
      ],
    },
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/composition/**', '**/handlers/**', '**/infra/**'] },
      ],
    },
  },
  {
    files: ['src/handlers/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@aws-sdk/*', '#domain/*', '#application/*', '#infrastructure/*', 'zod'] },
      ],
    },
  },
);
