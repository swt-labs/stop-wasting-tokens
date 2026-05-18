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
      'a_non_production_files/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.eslint.json',
        ecmaFeatures: { jsx: true },
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
      // PR-11 Task A — relax rules that fire on legitimate v2.3.5 carry-forward
      // patterns the test-debt remediation pass doesn't reshape:
      // - require-await: async method signatures on interfaces where the
      //   impl doesn't currently await anything (createSession mock, probe,
      //   installAgent, etc.). The async signature is the contract.
      // - no-default-export: dashboard's Solid components export default per
      //   the Solid SFC convention; promoting them all to named exports is
      //   M2 PR-17 scope (dashboard SSE rewire).
      // - no-redundant-type-constituents: PiEventName explicitly accepts
      //   string fallback alongside the well-known literals so consumers
      //   get autocomplete on known events without losing the escape hatch.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
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
      // PR-11 Task A: severity demoted to 'warn' pending a pnpm-workspace-aware
      // resolver. The rule's path matching does not currently resolve
      // `@swt-labs/<pkg>` import strings to `packages/<pkg>/` paths through
      // pnpm's symlink layer, so legitimate cross-workspace imports get
      // false-positive errors. The zone declarations stay in place + the
      // structural eslint-boundary.test.ts validates them; runtime
      // enforcement promotes back to 'error' when M3 adds the resolver
      // (likely `eslint-import-resolver-typescript`). The
      // `no-restricted-imports` rule below enforces Principle 1
      // (@earendil-works/* only in runtime/) and works correctly today.
      'import/no-restricted-paths': [
        'warn',
        {
          zones: [
            { target: 'packages/shared', from: 'packages', except: ['packages/shared'] },
            {
              target: 'packages/core',
              from: 'packages',
              except: ['packages/core', 'packages/shared'],
            },
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
  // Pi extension-loader convention: `export default factory()` is how Pi
  // discovers + invokes registered extensions. The default export is the
  // contract, not a stylistic choice. Promoting these to named exports
  // would break Pi's extension discovery.
  {
    files: ['packages/runtime/src/extensions/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'import/no-default-export': 'off',
    },
  },
  // Dashboard client (Solid components) — v3-debt territory: M2 PR-17
  // owns the SSE rewire + component refactor. Until then, type-checked
  // rules that fire on existing Solid patterns are relaxed for the client
  // surface only (server-side dashboard code stays strict).
  {
    files: ['packages/dashboard/src/client/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-base-to-string': 'off',
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
