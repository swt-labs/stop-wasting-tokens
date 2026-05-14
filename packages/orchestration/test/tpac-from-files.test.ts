/**
 * Phase 5 plan 05-04 T2 — file → MeterSnapshot lift + criteria counter.
 *
 * Behaviour under test:
 *   - liftMeterSnapshot reads every `phase-*.json` and produces one
 *     MeterRecord per file with input/output/cache/cost summed.
 *   - Records carry the `milestone` label from opts; computeTpac()
 *     downstream filters records by that label, so this contract is
 *     load-bearing.
 *   - Missing `.metrics/` returns an empty snapshot (totals = 0,
 *     records = []).
 *   - countSatisfiedCriteria sums `passed: N` rows across every
 *     `<NN>-VERIFICATION.md`.
 *   - Missing `phases/` returns 0.
 *   - The lifted snapshot is a valid input to `computeTpac()` —
 *     `TpacReportSchema.safeParse(result).success === true`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TpacReportSchema } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { liftMeterSnapshot, countSatisfiedCriteria } from '../src/tpac-from-files.js';
import { computeTpac } from '../src/tpac-meter.js';

function writePhaseMetrics(
  planningRoot: string,
  phaseSlug: string,
  tokens: { in: number; out: number; cache_read?: number; cache_creation?: number },
  cost = 0,
): void {
  mkdirSync(join(planningRoot, '.metrics'), { recursive: true });
  writeFileSync(
    join(planningRoot, '.metrics', `phase-${phaseSlug}.json`),
    JSON.stringify({
      session_id: phaseSlug,
      phase_slug: phaseSlug,
      agent_results: 1,
      tokens: {
        in: tokens.in,
        out: tokens.out,
        cache_creation: tokens.cache_creation ?? 0,
        cache_read: tokens.cache_read ?? 0,
      },
      cost_usd: cost,
      cache_hit_ratio: 0,
      last_updated: '2026-05-13T12:00:00Z',
    }),
    'utf-8',
  );
}

function writeVerification(
  planningRoot: string,
  phaseSlug: string,
  passed: number,
  failed = 0,
): void {
  const num = /^(\d+)-/.exec(phaseSlug)?.[1] ?? phaseSlug;
  const dir = join(planningRoot, 'phases', phaseSlug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${num}-VERIFICATION.md`),
    `---\npassed: ${passed}\nfailed: ${failed}\ntotal: ${passed + failed}\n---\n# Verification\n`,
    'utf-8',
  );
}

describe('liftMeterSnapshot + countSatisfiedCriteria (plan 05-04 T2)', () => {
  let tmpRoot: string;
  let planningRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'swt-tpac-from-files-'));
    planningRoot = join(tmpRoot, '.swt-planning');
    mkdirSync(planningRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('reads two phase-*.json files into two MeterRecords with summed totals', () => {
    writePhaseMetrics(planningRoot, '01-research', { in: 1000, out: 500, cache_read: 200 }, 0.01);
    writePhaseMetrics(planningRoot, '02-build', { in: 2000, out: 1500, cache_creation: 300 }, 0.05);

    const snap = liftMeterSnapshot({ planningRoot, milestone: 'M-test' });

    expect(snap.records.length).toBe(2);
    const phases = snap.records.map((r) => r.phase).sort();
    expect(phases).toEqual(['01-research', '02-build']);
    for (const r of snap.records) {
      expect(r.milestone).toBe('M-test');
      expect(r.role).toBe('aggregate');
      expect(r.task_id).toBe('aggregate');
    }
    expect(snap.totals.input).toBe(3000);
    expect(snap.totals.output).toBe(2000);
    expect(snap.totals.cacheRead).toBe(200);
    expect(snap.totals.cacheWrite).toBe(300);
    expect(snap.totals.cost_usd).toBeCloseTo(0.06);
  });

  it('returns an empty snapshot when .metrics/ is missing', () => {
    const snap = liftMeterSnapshot({ planningRoot, milestone: 'M-empty' });
    expect(snap.records.length).toBe(0);
    expect(snap.totals.input).toBe(0);
    expect(snap.totals.output).toBe(0);
    expect(snap.totals.cost_usd).toBe(0);
  });

  it('ignores session-*.json files and non-JSON entries under .metrics/', () => {
    writePhaseMetrics(planningRoot, '01-only', { in: 100, out: 50 });
    mkdirSync(join(planningRoot, '.metrics'), { recursive: true });
    writeFileSync(
      join(planningRoot, '.metrics', 'session-abc.json'),
      JSON.stringify({ session_id: 'abc', tokens: { in: 999, out: 999 } }),
      'utf-8',
    );
    writeFileSync(join(planningRoot, '.metrics', 'NOTES.txt'), 'ignored', 'utf-8');

    const snap = liftMeterSnapshot({ planningRoot, milestone: 'M-x' });
    expect(snap.records.length).toBe(1);
    expect(snap.records[0]?.phase).toBe('01-only');
    expect(snap.totals.input).toBe(100);
  });

  it('applies defaultProvider + defaultModel when files omit those fields', () => {
    writePhaseMetrics(planningRoot, '01-stub', { in: 10, out: 5 });
    const snap = liftMeterSnapshot({
      planningRoot,
      milestone: 'M-p',
      defaultProvider: 'openrouter',
      defaultModel: 'claude-sonnet-4-5-20250929',
    });
    expect(snap.records[0]?.provider).toBe('openrouter');
    expect(snap.records[0]?.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('skips malformed JSON files without throwing', () => {
    mkdirSync(join(planningRoot, '.metrics'), { recursive: true });
    writeFileSync(join(planningRoot, '.metrics', 'phase-broken.json'), '{ not valid json', 'utf-8');
    writePhaseMetrics(planningRoot, '02-ok', { in: 7, out: 3 });
    const snap = liftMeterSnapshot({ planningRoot, milestone: 'M-broken' });
    expect(snap.records.length).toBe(1);
    expect(snap.records[0]?.phase).toBe('02-ok');
  });

  it('countSatisfiedCriteria sums passed: N across every VERIFICATION.md', () => {
    writeVerification(planningRoot, '01-research', 4);
    writeVerification(planningRoot, '02-build', 7, 2);
    writeVerification(planningRoot, '03-noverification-yet', 0);
    expect(countSatisfiedCriteria(planningRoot)).toBe(11);
  });

  it('countSatisfiedCriteria returns 0 when phases/ is missing', () => {
    expect(countSatisfiedCriteria(planningRoot)).toBe(0);
  });

  it('lifted snapshot feeds computeTpac and yields a TpacReportSchema-valid object', () => {
    writePhaseMetrics(planningRoot, '01-research', { in: 1000, out: 500 }, 0.01);
    writePhaseMetrics(planningRoot, '02-build', { in: 2000, out: 1500 }, 0.05);
    writeVerification(planningRoot, '01-research', 3);
    writeVerification(planningRoot, '02-build', 2);

    const snap = liftMeterSnapshot({ planningRoot, milestone: 'M-tpac' });
    const criteria = countSatisfiedCriteria(planningRoot);
    expect(criteria).toBe(5);

    const report = computeTpac(snap, {
      milestone: 'M-tpac',
      fixture: 'unit-fixture',
      criteria_satisfied: criteria,
    });
    const parsed = TpacReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
    expect(report.tpac_input).toBe(3000);
    expect(report.tpac_output).toBe(2000);
    expect(report.tpac_total).toBe(5000);
    expect(report.criteria_satisfied).toBe(5);
    expect(report.tokens_per_criterion).toBe(1000);
    expect(report.cost_usd).toBeCloseTo(0.06);
  });
});
