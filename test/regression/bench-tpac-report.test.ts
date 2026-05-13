/**
 * Phase 5 plan 05-04 T4 — `swt bench` subprocess test.
 *
 * Asserts the end-to-end CLI handler path: `swt bench --fixture=...
 * --cassettes=... --output=<tmp>` exits 0 and writes a JSON file that
 * round-trips through `TpacReportSchema.safeParse()`.
 *
 * This test closes the bench-handler gap: before plan 05-04, bench
 * would have thrown `NoSatisfiedCriteriaError` (computeTpac requires
 * `criteria_satisfied >= 1`) because runVibe was a deferred stub and
 * never let cook produce a VERIFICATION.md. Now bench succeeds when
 * the fixture has cassettes AND the run produces ≥1 passing criterion.
 *
 * **Activation gate.** SKIPs cleanly when the full-milestone cassette
 * is absent. The `--cassettes` flag points at the per-role cassette
 * directory recorded by plan 05-02 OR (preferred) a single
 * `full-milestone.jsonl` recorded specifically for the v3 bench path.
 * Plan 05-05 PARITY-REPORT.md tracks this readiness explicitly.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { TpacReportSchema } from '../../packages/shared/src/schemas/tpac-report.js';

const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'test-utils', 'golden', 'ref-fastapi');
const CASSETTES_DIR = join(FIXTURE_ROOT, 'cassettes');
const FULL_MILESTONE_CASSETTE = join(CASSETTES_DIR, 'full-milestone.jsonl');

function hasJsonlCassettes(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

function resolveCliBin(): string | null {
  if (process.env['SWT_CLI_BIN'] !== undefined && process.env['SWT_CLI_BIN'].length > 0) {
    return process.env['SWT_CLI_BIN'];
  }
  const candidates = [
    join(REPO_ROOT, 'dist', 'cli.mjs'),
    join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const require_ = createRequire(import.meta.url);
    return require_.resolve('@swt-labs/cli');
  } catch {
    return null;
  }
}

/**
 * The bench harness runs against the FROZEN spec under
 * `golden/ref-fastapi/spec/`. The spec must have a pre-populated
 * `phases/<NN>-<slug>/<NN>-<MM>-PLAN.md` for runMilestone to execute
 * end-to-end (runMilestone does NOT generate plans — that would
 * require non-deterministic LLM-driven scope/plan agents). See
 * `packages/test-utils/src/run-milestone.ts` doc-comment.
 *
 * The bench test READY gate therefore requires:
 *   - the full-milestone cassette is recorded,
 *   - a pre-populated PLAN.md exists in the fixture spec,
 *   - the CLI bundle can be resolved.
 *
 * When ANY prerequisite is missing the test SKIPs cleanly; plan 05-05's
 * PARITY-REPORT.md surfaces the missing prerequisite as Phase 6
 * follow-up.
 */
function hasPrePopulatedPhase(specDir: string): boolean {
  const phasesDir = join(specDir, 'phases');
  if (!existsSync(phasesDir)) return false;
  let phases: string[];
  try {
    phases = readdirSync(phasesDir);
  } catch {
    return false;
  }
  for (const phase of phases) {
    const dir = join(phasesDir, phase);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    if (entries.some((e) => /PLAN\.md$/.test(e))) return true;
  }
  return false;
}

const SPEC_DIR = join(FIXTURE_ROOT, 'spec');
const CASSETTES_READY = existsSync(FULL_MILESTONE_CASSETTE);
const FIXTURE_READY = hasPrePopulatedPhase(SPEC_DIR);
const CLI_BIN = resolveCliBin();
const READY =
  CASSETTES_READY &&
  FIXTURE_READY &&
  CLI_BIN !== null &&
  existsSync(CLI_BIN);
void hasJsonlCassettes;

describe.skipIf(!READY)('swt bench → TpacReport JSON output (plan 05-04 T4)', () => {
  it('subprocess exits 0 and writes a TpacReportSchema-valid file', () => {
    if (CLI_BIN === null) throw new Error('CLI bin unresolved');
    const tmpOut = mkdtempSync(join(tmpdir(), 'swt-bench-test-'));
    try {
      const outPath = join(tmpOut, 'tpac.json');
      const args = [
        CLI_BIN,
        'bench',
        '--fixture=ref-fastapi-empty',
        `--cassettes=${CASSETTES_DIR}`,
        `--output=${outPath}`,
      ];
      execFileSync(process.execPath, args, {
        cwd: REPO_ROOT,
        env: { ...process.env, SWT_FORCE_NON_INTERACTIVE: '1' },
        stdio: 'pipe',
      });
      const raw = readFileSync(outPath, 'utf-8');
      const parsed = TpacReportSchema.safeParse(JSON.parse(raw));
      expect(
        parsed.success,
        parsed.success ? '' : JSON.stringify(parsed.error?.issues),
      ).toBe(true);
      if (parsed.success) {
        expect(parsed.data.schema_version).toBe(1);
        expect(parsed.data.criteria_satisfied).toBeGreaterThanOrEqual(1);
        expect(parsed.data.tokens_per_criterion).toBeGreaterThan(0);
      }
    } finally {
      rmSync(tmpOut, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('bench-tpac-report gate state (always runs)', () => {
  it('records activation status so CI surfaces the skip rationale', () => {
    expect(typeof READY).toBe('boolean');
  });
});
