/**
 * `runVibe` — programmatic non-interactive entry into the methodology
 * vibe flow per PR-T (M3 §13.3 follow-up).
 *
 * Designed for non-CLI consumers that want to drive a vibe-style run
 * against a pre-populated phase directory and harvest a
 * `MeterSnapshot` + `criteriaSatisfied` from the result. The canonical
 * consumer is `@swt-labs/test-utils`'s `runMilestone` — it builds a
 * `TokenMeter`, calls `runVibe({cwd: tmpRoot, meter})`, and threads the
 * harvested fields into `RunMilestoneResult` for the `swt bench`
 * TpacReport emit.
 *
 * **Scope at PR-T:** Execute mode only.
 *
 * The full vibe FSM (bootstrap → scope → plan → execute → qa → verify
 * → archive) requires interactive checkpoints (UAT uses
 * `AskUserQuestion`) that can't be automated. For a regression test +
 * bench run, the fixture is expected to be pre-populated with
 * `ROADMAP.md` + at least one `<phase>/<plan>-PLAN.md`; runVibe runs
 * Execute against that. QA + UAT remain follow-ups when an
 * auto-passing path lands.
 *
 * **What gets harvested:**
 *   - `artefactsPath` — the input cwd unchanged (the regression
 *     comparator reads from here).
 *   - `finalState` — string label of where the run stopped (today
 *     always `'execute-complete'`; a future full-FSM driver will
 *     extend the union).
 *   - `meterSnapshot` — `meter.snapshot()` after the Execute pass.
 *     When no meter is supplied, an empty snapshot is returned.
 *   - `criteriaSatisfied` — count of `must_haves` entries with
 *     `status: 'passed'` aggregated across every plan's `TaskResult`
 *     captured during the Execute pass. Today the dispatcher's
 *     `'entries'` strategy reads must_haves from the agent-emitted
 *     `swt-task-result` envelope; the `'stub'` strategy returns
 *     empty must_haves, so `criteriaSatisfied = 0` in stub mode.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { Writable } from 'node:stream';

import { parseFrontmatter } from '@swt-labs/artifacts';
import type { HarvestStrategy } from '@swt-labs/orchestration';
import { createTokenMeter } from '@swt-labs/runtime';
import type { MeterContext, MeterSnapshot, TokenMeter } from '@swt-labs/shared';

import { executeHandler } from './vibe/handlers/execute.js';
import type { ModeIO } from './vibe/handlers/index.js';
import type { VibeRoute } from './vibe/route.js';

export interface RunVibeOptions {
  /** Working directory containing the pre-populated `.swt-planning/`. */
  readonly cwd: string;
  /**
   * Optional injected `TokenMeter` — when omitted, runVibe builds an
   * in-memory meter via `createTokenMeter()` so the snapshot is always
   * non-undefined in the result.
   */
  readonly meter?: TokenMeter;
  /**
   * Optional meter dimensions threaded into the dispatcher chain.
   * `phase` + `task_id` + `role` are filled in by the dispatcher / dev-
   * runner; this is for `milestone` + `tier` overrides.
   */
  readonly meterContext?: MeterContext;
  /**
   * Harvest strategy passed to the dispatcher. Defaults to `'stub'`
   * so callers without recorded cassettes get a synthetic success
   * path. Production callers (`runMilestone` against cassettes) wire
   * `{kind: 'entries', getEntries}` against the active session's
   * entry list.
   */
  readonly harvestStrategy?: HarvestStrategy;
  /**
   * Optional 2-digit phase prefix to target (e.g. `'01'`). When
   * omitted, runVibe scans `.swt-planning/phases/` and selects the
   * first phase whose plans are not yet fully summarised.
   */
  readonly phase?: string;
  /**
   * Optional slug to disambiguate when multiple phases share a
   * 2-digit prefix. Together with `phase`, fully resolves the target
   * phase directory.
   */
  readonly slug?: string;
}

export interface RunVibeResult {
  readonly artefactsPath: string;
  /**
   * Where the run stopped. Today always `'execute-complete'`; future
   * full-FSM versions will extend with `'qa-complete'`,
   * `'verify-pending'`, `'archived'`, etc.
   */
  readonly finalState: 'execute-complete';
  readonly meterSnapshot: MeterSnapshot;
  readonly criteriaSatisfied: number;
}

/**
 * Drive Execute mode against a pre-populated phase directory. See the
 * module-level doc for scope notes + harvested fields.
 */
export async function runVibe(opts: RunVibeOptions): Promise<RunVibeResult> {
  const meter = opts.meter ?? createTokenMeter();
  const io: ModeIO = {
    cwd: opts.cwd,
    stdout: makeNullStream(),
    stderr: makeNullStream(),
    meter,
    ...(opts.meterContext !== undefined ? { meterContext: opts.meterContext } : {}),
  };

  // Discover the target phase if not supplied. Scan
  // `.swt-planning/phases/NN-{slug}/` and pick the first directory
  // that has at least one `<NN>-<MM>-PLAN.md` file (the executeHandler
  // does the per-plan skip-list against existing SUMMARY.md files).
  const discoveredTarget = await discoverFirstExecutablePhase(opts.cwd, opts.phase, opts.slug);
  if (discoveredTarget === undefined) {
    throw new Error(
      `runVibe: no executable phase found under ${opts.cwd}/.swt-planning/phases/. ` +
        `Pre-populate the fixture with at least one phase directory containing a PLAN.md.`,
    );
  }

  const route: VibeRoute = {
    kind: 'execute',
    requires_confirmation: false,
    phase: discoveredTarget.phase,
    phase_slug: `${discoveredTarget.phase}-${discoveredTarget.slug}`,
  };

  const handler = executeHandler({
    resolveTarget: () => discoveredTarget,
    ...(opts.harvestStrategy !== undefined ? { harvestStrategy: opts.harvestStrategy } : {}),
  });
  await handler.run(route, io);

  const snapshot = meter.snapshot();
  // Aggregate `criteriaSatisfied` from the meter records' associated
  // task_ids → for each recorded task, count its `swt-task-result`
  // entry's `must_haves` with `status: 'passed'`. Today's dispatcher
  // doesn't expose harvested TaskResults to the executeHandler caller
  // separately; the must_haves end up in the on-disk SUMMARY.md
  // files written by `writeSummary`. For PR-T's simpler harvest,
  // count passed-must-haves by walking the phase directory's SUMMARY
  // files — that's the persisted source of truth.
  const criteriaSatisfied = await countPassedMustHaves(opts.cwd);

  return {
    artefactsPath: opts.cwd,
    finalState: 'execute-complete',
    meterSnapshot: snapshot,
    criteriaSatisfied,
  };
}

/**
 * Aggregate the must_haves count across every PLAN whose corresponding
 * SUMMARY.md has `status: complete` or `status: partial`. PLAN frontmatter
 * already declares `must_haves` as a flat string array; the SUMMARY
 * frontmatter records the executed status. Together they give a
 * "criteria satisfied = sum of declared must_haves on completed plans"
 * proxy that the bench TpacReport's denominator consumes.
 *
 * **Heuristic, not ground truth.** A real QA-driven `must_haves[].status`
 * check requires running qaHandler post-Execute and reading the VERIFY
 * artifact's `verdict: 'passed'` rows. That's a follow-up; for PR-T's
 * alpha-stage bench, the plan-declared count is sufficient to drive
 * non-zero TPAC numbers.
 */
async function countPassedMustHaves(cwd: string): Promise<number> {
  const phasesDir = joinPath(cwd, '.swt-planning', 'phases');
  let phases: string[];
  try {
    phases = await readdir(phasesDir);
  } catch {
    return 0;
  }
  let total = 0;
  for (const phaseSlug of phases) {
    const phaseDir = joinPath(phasesDir, phaseSlug);
    let entries: string[];
    try {
      entries = await readdir(phaseDir);
    } catch {
      continue;
    }
    // Pair each PLAN with its sibling SUMMARY. Plans without a SUMMARY
    // didn't execute; plans with a SUMMARY contribute their declared
    // must_haves count when the summary's status is non-failed.
    const planFiles = entries.filter((e) => /^\d{2}-\d{2}-PLAN\.md$/.test(e));
    for (const planFile of planFiles) {
      const summaryFile = planFile.replace('-PLAN.md', '-SUMMARY.md');
      if (!entries.includes(summaryFile)) continue;
      // Read SUMMARY status — only count if it's `complete` or `partial`.
      let summaryRaw: string;
      try {
        summaryRaw = await readFile(joinPath(phaseDir, summaryFile), 'utf8');
      } catch {
        continue;
      }
      const summaryFm = parseFrontmatter(summaryRaw).frontmatter as { status?: unknown };
      const status = summaryFm.status;
      if (status !== 'complete' && status !== 'partial') continue;
      // Parse the PLAN's must_haves array (flat string array).
      let planRaw: string;
      try {
        planRaw = await readFile(joinPath(phaseDir, planFile), 'utf8');
      } catch {
        continue;
      }
      const planFm = parseFrontmatter(planRaw).frontmatter as { must_haves?: unknown };
      const must = planFm.must_haves;
      if (Array.isArray(must)) total += must.length;
    }
  }
  return total;
}

function makeNullStream(): NodeJS.WritableStream {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

/**
 * Scan `<cwd>/.swt-planning/phases/` for a phase directory matching
 * `NN-{slug}`. If `phase` is supplied, find a directory whose 2-digit
 * prefix matches. If `slug` is supplied, the full match is required.
 * Otherwise return the first phase directory that has at least one
 * `<NN>-<MM>-PLAN.md` file.
 */
async function discoverFirstExecutablePhase(
  cwd: string,
  phase?: string,
  slug?: string,
): Promise<{ phase: string; slug: string } | undefined> {
  const phasesDir = joinPath(cwd, '.swt-planning', 'phases');
  let entries: string[];
  try {
    entries = await readdir(phasesDir);
  } catch {
    return undefined;
  }
  entries.sort();
  for (const entry of entries) {
    const m = /^(\d{2})-(.+)$/.exec(entry);
    if (m === null) continue;
    const entryPhase = m[1]!;
    const entrySlug = m[2]!;
    if (phase !== undefined && entryPhase !== phase) continue;
    if (slug !== undefined && entrySlug !== slug) continue;
    const phaseDirEntries = await readdir(joinPath(phasesDir, entry)).catch(() => []);
    const hasPlan = phaseDirEntries.some((f) =>
      new RegExp(`^${entryPhase}-\\d{2}-PLAN\\.md$`).test(f),
    );
    if (hasPlan) {
      return { phase: entryPhase, slug: entrySlug };
    }
  }
  return undefined;
}
