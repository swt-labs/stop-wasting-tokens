import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '.vbw-planning/**',
      '.changeset/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.eslint.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...tseslint.configs['recommended-type-checked'].rules,
      'import/order': [
        'error',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        },
      ],
      'import/no-default-export': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // PR-10 Task 1: layered-architecture enforcement per TDD2 §4.3 From→May-import table.
  // Matches the §4.3 layering exactly: shared = leaf (no other workspace pkg);
  // core / runtime each import only shared; orchestration may import core+runtime+shared;
  // dashboard may import core+orchestration+runtime+shared (NOT cli); cli may import
  // dashboard+core+orchestration+runtime+shared. test-utils may import any (it's the
  // test seam package, not a layer).
  {
    files: ['packages/**/*.{ts,tsx,mts,cts}'],
    plugins: { import: importPlugin },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: 'packages/shared', from: 'packages', except: ['packages/shared'] },
            { target: 'packages/core', from: 'packages', except: ['packages/core', 'packages/shared'] },
            {
              target: 'packages/runtime',
              from: 'packages',
              except: ['packages/runtime', 'packages/shared'],
            },
            {
              target: 'packages/orchestration',
              from: 'packages',
              except: [
                'packages/orchestration',
                'packages/core',
                'packages/runtime',
                'packages/shared',
              ],
            },
            {
              target: 'packages/dashboard',
              from: 'packages',
              except: [
                'packages/dashboard',
                'packages/core',
                'packages/orchestration',
                'packages/runtime',
                'packages/shared',
              ],
            },
            {
              target: 'packages/cli',
              from: 'packages',
              except: [
                'packages/cli',
                'packages/dashboard',
                'packages/core',
                'packages/orchestration',
                'packages/runtime',
                'packages/shared',
                'packages/artifacts',
                'packages/methodology',
                'packages/telemetry',
                'packages/verification',
              ],
            },
          ],
        },
      ],
      // Principle 1 enforcement (TDD2 §4.3): only runtime/ may import @earendil-works/*.
      // Other packages must go through runtime's exported helpers (e.g., probePiAvailable).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@earendil-works/*'],
              message:
                'Principle 1: only packages/runtime/ may import from @earendil-works/*. See TDD2 §4.3 + ADR-001.',
            },
          ],
        },
      ],
    },
  },
  // Override @earendil-works ban for runtime/ — it's THE Pi adapter.
  {
    files: ['packages/runtime/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // test-utils is the test-seam package and may cross layer lines for fixtures.
  {
    files: ['packages/test-utils/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'import/no-restricted-paths': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.config.{ts,mts,js,mjs}', '**/vitest.config.ts', '**/tsup.config.ts'],
    rules: {
      'import/no-default-export': 'off',
    },
  },
  {
    // Test files use mock values typed `any` and intentionally-loose async
    // signatures by convention. The type-checked rules below add cost without
    // catching real bugs in tests. They stay strict in `src/`.
    files: ['**/test/**/*.ts', '**/*.test.ts', '**/*.spec.ts', 'docs/test/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
  prettier,
];
