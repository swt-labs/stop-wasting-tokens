/**
 * Phase 5 plan 05-04 T2 — file → `MeterSnapshot` lift + criteria counter.
 *
 * Phase 4 plan 04-01 wired `recordUsage()` in `@swt-labs/methodology` to
 * write `.swt-planning/.metrics/{session,phase}-*.json`. This module is
 * the **reducer side** of that pipeline: it reads those files, folds
 * each `phase-*.json` into one `MeterRecord` row, and produces a
 * `MeterSnapshot` consumable by `computeTpac()` in `tpac-meter.ts`.
 *
 * Two exports (research §4.3 + §4.4):
 *
 *   - `liftMeterSnapshot({ planningRoot, milestone, ... })` — reads
 *     every `.metrics/phase-*.json` under the planning root, builds
 *     one `MeterRecord` per phase, returns a `MeterSnapshot` with
 *     summed totals.
 *
 *   - `countSatisfiedCriteria(planningRoot)` — walks `phases/*\/`,
 *     regex-extracts `passed: N` from each `<NN>-VERIFICATION.md`
 *     frontmatter (or body), sums + returns the total.
 *
 * Pure file I/O. No in-memory state, no caching beyond a single
 * function call. Empty `.metrics/` returns `{ totals: zero, records: [] }`.
 * Missing `phases/` returns 0 criteria.
 *
 * **Why this lives in orchestration, not methodology.** Per Principle 2
 * (TDD2 §4.3): orchestration is the methodology-level interpretation
 * layer that owns TPAC. methodology's token-meter is the producer;
 * orchestration's tpac-from-files is the consumer-side reducer that
 * feeds `computeTpac()`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MeterRecord, MeterSnapshot } from '@swt-labs/shared';

export interface LiftMeterSnapshotOptions {
  /**
   * Absolute path to the project's planning root. The lift reads
   * `<planningRoot>/.metrics/phase-*.json` files. When the directory
   * is missing the function returns an empty snapshot.
   */
  readonly planningRoot: string;
  /**
   * Milestone label written into every lifted `MeterRecord.milestone`
   * field. Used as the filter key by `computeTpac()` — passing the
   * same value to both keeps records visible to the aggregator.
   */
  readonly milestone: string;
  /**
   * Provider label applied when a phase-*.json file lacks a `provider`
   * field (Phase 4 SessionMetrics shape does not carry provider; this
   * is the fallback for the v3 dual-provider future). Defaults to
   * `'anthropic'`.
   */
  readonly defaultProvider?: string;
  /**
   * Model label applied when a phase-*.json file lacks a `model`
   * field. Defaults to `'unknown'`. Plan 05-05 surfaces a deviation
   * if production runs land here without resolving the dominant model.
   */
  readonly defaultModel?: string;
}

/**
 * Shape of the phase metrics JSON written by Phase 4 04-01
 * `recordUsage()` — `packages/methodology/src/meters/token-meter.ts`.
 * We re-derive the shape here (instead of importing
 * `SessionMetrics` from methodology) to avoid an orchestration → methodology
 * dep edge that contradicts Principle 2.
 */
interface PhaseMetricsFileShape {
  readonly session_id?: string;
  readonly phase_slug?: string;
  readonly agent_results?: number;
  readonly tokens?: {
    readonly in?: number;
    readonly out?: number;
    readonly cache_creation?: number;
    readonly cache_read?: number;
  };
  readonly cost_usd?: number;
  readonly cache_hit_ratio?: number;
  readonly last_updated?: string;
  /**
   * Provider + model are NOT written by Phase 4 04-01 yet — see plan
   * 05-04's open question on this. Reserved here so a future Phase 5
   * patch to token-meter that adds them will lift through cleanly.
   */
  readonly provider?: string;
  readonly model?: string;
}

/**
 * Read every `<planningRoot>/.metrics/phase-*.json` and build a
 * `MeterSnapshot` where each file contributes one `MeterRecord` row
 * (input/output/cache/cost summed from the file's tokens block).
 */
export function liftMeterSnapshot(opts: LiftMeterSnapshotOptions): MeterSnapshot {
  const metricsDir = join(opts.planningRoot, '.metrics');
  const records: MeterRecord[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;

  const defaultProvider = opts.defaultProvider ?? 'anthropic';
  const defaultModel = opts.defaultModel ?? 'unknown';

  if (!existsSync(metricsDir)) {
    return emptySnapshot();
  }

  let entries: string[];
  try {
    entries = readdirSync(metricsDir);
  } catch {
    return emptySnapshot();
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    if (!entry.startsWith('phase-')) continue;
    const filePath = join(metricsDir, entry);
    let parsed: PhaseMetricsFileShape;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as PhaseMetricsFileShape;
    } catch {
      continue;
    }
    const tokens = parsed.tokens ?? {};
    const input = tokens.in ?? 0;
    const output = tokens.out ?? 0;
    const cacheRead = tokens.cache_read ?? 0;
    const cacheWrite = tokens.cache_creation ?? 0;
    const cost = parsed.cost_usd ?? 0;
    const phaseSlug =
      parsed.phase_slug ?? entry.replace(/^phase-/, '').replace(/\.json$/, '');

    records.push({
      timestamp: parsed.last_updated ?? new Date(0).toISOString(),
      milestone: opts.milestone,
      phase: phaseSlug,
      task_id: 'aggregate',
      role: 'aggregate',
      tier: 'aggregate',
      provider: parsed.provider ?? defaultProvider,
      model: parsed.model ?? defaultModel,
      turn: parsed.agent_results ?? 0,
      input,
      output,
      cacheRead,
      cacheWrite,
      cost_usd: cost,
    });

    totalIn += input;
    totalOut += output;
    totalCacheRead += cacheRead;
    totalCacheWrite += cacheWrite;
    totalCost += cost;
  }

  return {
    totals: {
      input: totalIn,
      output: totalOut,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      cost_usd: totalCost,
    },
    records,
  };
}

/**
 * Walk `<planningRoot>/phases/*\/`, regex-extract `passed: N` from each
 * `<NN>-VERIFICATION.md` (frontmatter or body), return the sum.
 *
 * **Phase-folder naming.** Matches `^(\d+)-...` slug. The VERIFICATION
 * file is `<NN>-VERIFICATION.md` where NN is the leading number of the
 * phase slug. Phases that lack a VERIFICATION.md (in-progress / not yet
 * verified) contribute 0.
 */
export function countSatisfiedCriteria(planningRoot: string): number {
  const phasesDir = join(planningRoot, 'phases');
  if (!existsSync(phasesDir)) return 0;
  let entries: string[];
  try {
    entries = readdirSync(phasesDir);
  } catch {
    return 0;
  }
  let total = 0;
  for (const phase of entries) {
    const match = /^(\d+)-/.exec(phase);
    if (match === null) continue;
    const num = match[1];
    const verPath = join(phasesDir, phase, `${num}-VERIFICATION.md`);
    if (!existsSync(verPath)) continue;
    let content: string;
    try {
      content = readFileSync(verPath, 'utf-8');
    } catch {
      continue;
    }
    const passed = /(?:^|\n)passed:\s*(\d+)/.exec(content);
    if (passed?.[1] !== undefined) {
      total += Number.parseInt(passed[1], 10);
    }
  }
  return total;
}

function emptySnapshot(): MeterSnapshot {
  return {
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost_usd: 0 },
    records: [],
  };
}
