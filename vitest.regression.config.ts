import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration scoped to the regression suite.
 *
 * The CI workflow `.github/workflows/regression.yml:11-15` triggers
 * on changes under `packages/**`, `test/regression/**`,
 * `packages/test-utils/golden/**`, and `packages/test-utils/cassettes/**`.
 * This config narrows the test include glob to the matching test paths
 * so `pnpm test:regression` runs only what the regression workflow
 * cares about.
 *
 * Phase 5 plan 05-01 task T4 — R7 CI gating wiring. Downstream plans
 * (05-02 / 05-03 / 05-04) add their tests inside `test/regression/`.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'test/regression/**/*.test.ts',
      'packages/test-utils/test/**/*.test.ts',
    ],
    testTimeout: 60_000,
  },
});
