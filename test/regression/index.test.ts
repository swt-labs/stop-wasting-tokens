/**
 * Regression suite bootstrap — minimal smoke ensuring the directory
 * is non-empty (the CI workflow at `.github/workflows/regression.yml:11`
 * path-triggers on `test/regression/**`) AND that `diffArtefacts`
 * resolves cleanly from the regression test path.
 *
 * Phase 5 plan 05-01 task T4 — R7 CI gating wiring.
 */

import { describe, expect, it } from 'vitest';

import { diffArtefacts } from '../../packages/test-utils/src/diff-artefacts.js';

describe('regression suite bootstrap', () => {
  it('diffArtefacts is importable from @swt-labs/test-utils', () => {
    expect(typeof diffArtefacts).toBe('function');
  });
});
