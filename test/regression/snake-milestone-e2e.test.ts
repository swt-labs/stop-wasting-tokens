/**
 * Phase 5 plan 05-04 T4 — snake fixture full-milestone e2e test
 * (smaller variant of `ref-fastapi-milestone.test.ts`).
 *
 * Complements `snake-canary.test.ts` (plan 05-03 T3): the canary asserts
 * the structural floor (anti-empty-PLAN.md regression); THIS test asserts
 * the full end-to-end including REQ-04 (`Game.step` resolvable) + REQ-05
 * (pytest passes) executed via `runMilestone` + the unstubbed `runVibe`.
 *
 * **Activation gate.** SKIPs cleanly when the synthetic
 * `milestone.jsonl` cassette is in place but contains no semantic
 * content (plan 05-03 ships it as a DEVN-03 placeholder per
 * `scripts/record-cassette-scenarios/snake-milestone.mjs` docstring).
 * Set `SNAKE_MILESTONE_E2E=1` to force-run once the cassette is
 * re-recorded against the real Anthropic API.
 *
 * The looser `SNAKE_CANARY_E2E=1` gate (snake-canary.test.ts) flips on
 * the SAME prerequisite — both tests activate together when the
 * developer-local recording lands.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, afterAll, beforeAll } from 'vitest';

import { TpacReportSchema } from '../../packages/shared/src/schemas/tpac-report.js';
import {
  disposeRun,
  runMilestone,
  type RunMilestoneResult,
} from '../../packages/test-utils/src/run-milestone.js';

const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'test-utils', 'golden', 'snake');
const CASSETTE_PATH = join(FIXTURE_ROOT, 'cassettes', 'milestone.jsonl');

const E2E_ENABLED = process.env['SNAKE_MILESTONE_E2E'] === '1';
const READY = E2E_ENABLED && existsSync(CASSETTE_PATH);

describe.skipIf(!READY)('snake full-milestone e2e (plan 05-04 T4)', () => {
  let result: RunMilestoneResult;

  beforeAll(async () => {
    result = await runMilestone({
      fixture: FIXTURE_ROOT,
      milestone: 'snake-m',
      fixtureId: 'snake',
    });
  }, 60_000);

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

  it('criteriaSatisfied >= 5 (one per REQ-01..REQ-05)', () => {
    expect(result.criteriaSatisfied).toBeGreaterThanOrEqual(5);
  });

  it('tpacReport is schema-valid + tokens_per_criterion < 100000 (sanity ceiling)', () => {
    expect(result.tpacReport).toBeDefined();
    const parsed = TpacReportSchema.safeParse(result.tpacReport);
    expect(parsed.success).toBe(true);
    expect(result.tpacReport?.tokens_per_criterion).toBeLessThan(100_000);
  });

  it('Dev produced snake/__main__.py + snake/game.py + tests/test_game.py', () => {
    const tmp = result.artefactsPath;
    for (const rel of ['snake/__main__.py', 'snake/game.py', 'tests/test_game.py']) {
      expect(existsSync(join(tmp, rel)), `${rel} must exist`).toBe(true);
    }
  });

  it('REQ-05: pytest tests/ exits 0 with >= 4 PASSED tests', () => {
    const r = spawnSync('pytest', ['tests/', '-v'], {
      cwd: result.artefactsPath,
      env: { ...process.env, PYTHONPATH: result.artefactsPath },
    });
    expect(r.status, `pytest stderr: ${r.stderr?.toString()}`).toBe(0);
    const out = r.stdout?.toString() ?? '';
    const passedCount = (out.match(/PASSED/g) ?? []).length;
    expect(passedCount).toBeGreaterThanOrEqual(4);
  });
});

describe('snake-milestone-e2e gate state (always runs)', () => {
  it('records the activation status so CI summarises the skip rationale', () => {
    expect(typeof READY).toBe('boolean');
  });
});
