/**
 * Phase 5 plan 05-04 T4 — ref-fastapi full-milestone e2e regression test.
 *
 * **Activation gates (both required).** The test SKIPs cleanly until:
 *   1. The full-milestone cassette is recorded at
 *      `packages/test-utils/golden/ref-fastapi/cassettes/full-milestone.jsonl`
 *      (a developer-local Anthropic-API recording session;
 *      `docs/operations/cassette-recording.md` documents the recipe).
 *   2. The v2.3.5 baseline tree is recorded at
 *      `packages/test-utils/golden/ref-fastapi/v2-baseline/.swt-planning/`
 *      AND the sentinel `STATE.md` no longer contains the
 *      `DEVN-03 placeholder` marker (plan 05-04 T3 ships the
 *      placeholder; the recording replaces it).
 *
 * **What the test asserts (when active):**
 *   - `runMilestone({ fixture, cassettesDir })` resolves with
 *     `runVibeResult.exitCode === 0`.
 *   - The produced `.swt-planning/` tree byte-matches the v2-baseline
 *     modulo the allowed drift in `diffArtefacts`'s `DEFAULT_CLASSIFIERS`
 *     (plan 05-02).
 *   - `tpacReport` validates against `TpacReportSchema` with
 *     `schema_version === 1` and `criteria_satisfied >= 1`.
 *
 * Plan 05-05's PARITY-REPORT.md surfaces this test's status (SKIP vs
 * PASS vs FAIL) as a Phase 5 exit signal.
 */

import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { TpacReportSchema } from '../../packages/shared/src/schemas/tpac-report.js';
import { diffArtefacts } from '../../packages/test-utils/src/diff-artefacts.js';
import {
  disposeRun,
  runMilestone,
  type RunMilestoneResult,
} from '../../packages/test-utils/src/run-milestone.js';

const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURE_ROOT = join(
  REPO_ROOT,
  'packages',
  'test-utils',
  'golden',
  'ref-fastapi',
);
const CASSETTE_PATH = join(FIXTURE_ROOT, 'cassettes', 'full-milestone.jsonl');
const BASELINE_DIR = join(FIXTURE_ROOT, 'v2-baseline');
const BASELINE_PLANNING = join(BASELINE_DIR, '.swt-planning');
const BASELINE_STATE = join(BASELINE_PLANNING, 'STATE.md');

function isPlaceholderBaseline(): boolean {
  // Plan 05-04 T3 ships a DEVN-03 sentinel STATE.md. Until a real
  // v2.3.5 recording replaces it, the regression test SKIPs.
  if (!existsSync(BASELINE_STATE)) return true;
  try {
    return readFileSync(BASELINE_STATE, 'utf-8').includes('DEVN-03 placeholder');
  } catch {
    return true;
  }
}

const READY =
  existsSync(CASSETTE_PATH) &&
  existsSync(BASELINE_PLANNING) &&
  !isPlaceholderBaseline();

describe.skipIf(!READY)('ref-fastapi full-milestone e2e (plan 05-04 T4)', () => {
  let result: RunMilestoneResult;

  beforeAll(async () => {
    result = await runMilestone({
      fixture: FIXTURE_ROOT,
      milestone: 'M2',
      fixtureId: 'ref-fastapi-empty',
    });
  }, 120_000);

  afterAll(() => {
    if (result !== undefined) {
      disposeRun(result);
      try {
        rmSync(result.artefactsPath, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it('runVibe exits 0', () => {
    expect(result.runVibeResult.exitCode).toBe(0);
  });

  it('tpacReport is schema-valid with schema_version 1 + criteria_satisfied >= 1', () => {
    expect(result.tpacReport).toBeDefined();
    const parsed = TpacReportSchema.safeParse(result.tpacReport);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(result.tpacReport?.schema_version).toBe(1);
    expect(result.tpacReport?.criteria_satisfied).toBeGreaterThan(0);
    expect(result.tpacReport?.tokens_per_criterion).toBeGreaterThan(0);
  });

  it('produced .swt-planning matches v2-baseline (allowed drift per DEFAULT_CLASSIFIERS)', () => {
    const actualPlanning = join(result.artefactsPath, '.swt-planning');
    expect(existsSync(actualPlanning)).toBe(true);
    const report = diffArtefacts(actualPlanning, BASELINE_PLANNING);
    expect(
      report.violations,
      `expected zero diffArtefacts violations; got ${report.violations.length}: ${JSON.stringify(report.violations.slice(0, 5), null, 2)}`,
    ).toHaveLength(0);
  });
});

describe('ref-fastapi-milestone gate state (always runs)', () => {
  it('records the activation status so CI summarises the skip rationale', () => {
    // Scaffolding placeholder — like ref-fastapi.regression.test.ts, this
    // assertion documents the deferred-but-wired state. The actual
    // milestone test above activates the moment both recordings are
    // committed AND the DEVN-03 placeholder is removed from STATE.md.
    expect(typeof READY).toBe('boolean');
  });
});
