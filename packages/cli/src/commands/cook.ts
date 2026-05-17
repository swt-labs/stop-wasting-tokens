/**
 * `swt cook` — Plan 03-02 (Phase 3) Task 3 + 4: orchestrator entry handler.
 *
 * Implements the TDD3 §7 routing FSM:
 *
 *   1. §7.1 Pre-parse passes:
 *      - todo number resolution (bare integer with snapshot filter=null)
 *      - ref tag extraction (`(ref:XXXXXXXX)` suffix)
 *      - todo pickup boundary (claim ONLY after confirmation gate succeeds)
 *
 *   2. §7.2 Three input paths in order:
 *      - Path 1: flag detection (--plan / --execute / ... ) → mode + ModeOptions
 *      - Path 2: NL keyword routing → mode (with askUser confirmation)
 *      - Path 3: state detection via detectPhase()
 *
 *   3. §7.3 Eleven-priority routing table (verbatim port from commands/cook.md):
 *      - Priority 1: planning_dir_exists=false → "Run swt init first"
 *      - Priority 2: project_exists=false → Bootstrap mode (confirmed)
 *      - Priority 3: needs_uat_remediation → UAT Remediation mode
 *      - Priority 3.5: needs_qa_remediation → QA Remediation mode
 *      - Priority 4: needs_reverification → prepare-reverification.sh + Verify
 *      - Priority 5: milestone_uat_issues → Milestone UAT Recovery
 *      - Priority 6: phase_count=0 → Scope (confirmed)
 *      - Priority 7: needs_verification → QA gate + Verify
 *      - Priority 8: needs_discussion → Discuss (confirmed)
 *      - Priority 9: needs_plan_and_execute → Plan+Execute (confirmed)
 *      - Priority 10: needs_execute → Execute (confirmed)
 *      - Priority 11: all_done → Archive (with QA-attention fallbacks)
 *
 *   4. §7.4 Fallback patterns evaluated DURING routing (not in mode bodies).
 *
 *   5. §7.5 QA gate (12 reason labels, 6 override flags) — Task 4. Runs
 *      BEFORE the orchestrator session is spawned in priority 7.
 *
 * Architect decisions:
 *   R1: spawnOrchestratorSession is a separate code path (see
 *       packages/orchestration/src/spawn-orchestrator-session.ts).
 *   R2: swt_ask_user Pi custom-tool bridge is registered ONLY on the
 *       orchestrator session.
 *   R4: detectPhase() from @swt-labs/methodology is the PRIMARY phase
 *       detection path; the bash script remains the documented fallback
 *       for keys the TS version does not surface (currently none — the
 *       TS detector covers all 11 routing keys).
 *   R5: The QA gate is pure TypeScript — no LLM. It runs before any Pi
 *       spawn so the routing decision is deterministic + testable.
 */

import { execSync as nodeExecSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { resolve as resolvePath, join as joinPath, dirname } from 'node:path';

import {
  detectPhase,
  recordUsage,
  readPendingSignal,
  waitForResumeOrCancel,
  CookCancelledError,
  markCompleted,
  markCrashed,
  readExecutionState,
  writeExecutionState,
  createFileMeterAdapter,
  type ExecutionStateRecord,
  type PhaseDetectResult,
  type FileMeterAdapter,
} from '@swt-labs/methodology';
import {
  spawnOrchestratorSession,
  defaultPidChecker,
  createProviderRouter,
  createFallbackChain,
  FallbackChainExhaustedError,
  WorktreeManager,
  acquireLock,
  createLockOpsFromAcquireLock,
  type CompoundTier,
  type PidChecker,
  type ProviderFallbackEvent,
  type FallbackFailureReason,
  type RouterStrategy,
  type RouterTier,
  type SelectedVia,
} from '@swt-labs/orchestration';
import {
  askUser as defaultAskUser,
  createBudgetGate,
  createRateCardSource,
  projectSpawnCost,
  parseAuthConfig,
  DEFAULT_AUTH_CONFIG,
  resolveSpawnCredential,
  type AskUserResponse,
  type BudgetGate,
  type BudgetProjectionResult,
  type CostProjection,
  type AuthConfig,
  type AuthMode,
} from '@swt-labs/runtime';
import type { BudgetConfigSchemaT, RateCard, TaskBrief } from '@swt-labs/shared';
import type { CookEvent } from '@swt-labs/shared';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

// ────────────────────────────────────────────────────────────────────────────
// Plan 04-01 — Cook IPC event emitter (R1 file-tail decision).
//
// We write JSONL to .swt-planning/.events/cook-{sessionId}-{startTs}.jsonl;
// the dashboard's events-tailer.ts already consumes this glob. Synchronous
// appendFileSync because a crash mid-emission must still flush — cook
// events are infrequent (one per priority decision / spawn / result) so the
// sync cost is negligible against Pi turn latency.
// ────────────────────────────────────────────────────────────────────────────

function sanitizeStartTs(ts: string): string {
  return ts.replace(/[:.]/g, '-');
}

function eventsFilePath(cwd: string, sessionId: string, startTs: string): string {
  return joinPath(
    cwd,
    '.swt-planning',
    '.events',
    `cook-${sessionId}-${sanitizeStartTs(startTs)}.jsonl`,
  );
}

export function emitCookEvent(
  cwd: string,
  sessionId: string,
  startTs: string,
  event: CookEvent,
): void {
  try {
    const dir = joinPath(cwd, '.swt-planning', '.events');
    mkdirSync(dir, { recursive: true });
    appendFileSync(eventsFilePath(cwd, sessionId, startTs), JSON.stringify(event) + '\n');
  } catch {
    // Event emission must never break the cook turn. Swallow filesystem
    // errors — the dashboard pane will simply miss this event.
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Plan 06-01 (Phase 6) T3 — Resume probe.
//
// At cookHandler entry we read .execution-state.json + tail the cook events
// JSONL channel to detect a prior crashed session. Three AND conditions
// constitute a "crash":
//
//   (a) status === 'in_progress' in execution-state.json
//   (b) PidChecker.isAlive(state.pid) === false (recorded pid is dead)
//   (c) no cook.completion event exists for the recorded session_id
//
// If all three hold → action='resume'. The probe consults the journal for
// the last cook.task_commit{commit_hash} and returns from_task = the next
// task id (best-effort — the orchestrator's runMode is the source of truth
// for task sequencing; we surface the journal high-water mark to the
// dashboard via cook.resume).
//
// A live recorded pid → action='abort_another_cook_running' (refuse to
// race two cooks against the same execution-state). Missing journal →
// action='fresh_run' (best-effort). cook.completion already present →
// action='fresh_run' AND markCompleted to clear the stale in_progress
// flag so the next probe doesn't re-fire.
// ────────────────────────────────────────────────────────────────────────────

export type ResumeDecision =
  | { kind: 'no_state' }
  | { kind: 'fresh_run'; reason: string }
  | { kind: 'paused_resume' }
  | { kind: 'resume'; fromTask: string; lastCommitHash: string | undefined }
  | { kind: 'abort_another_cook_running'; pid: number };

export interface ProbeForResumeDeps {
  readonly pidChecker?: PidChecker;
}

interface JournalEntry {
  readonly type: string;
  readonly task_id?: string;
  readonly commit_hash?: string;
  readonly session_id?: string;
}

function findEventsFileForSession(
  cwd: string,
  sessionId: string,
  existsSyncFn: typeof existsSync,
  readdirSyncImpl?: (dir: string) => string[],
): string | undefined {
  const dir = joinPath(cwd, '.swt-planning', '.events');
  if (!existsSyncFn(dir)) return undefined;
  // Sync IO is fine here — the probe runs once at cookHandler entry.
  const readdir = readdirSyncImpl ?? ((d: string): string[] => readdirSync(d));
  let names: string[];
  try {
    names = readdir(dir);
  } catch {
    return undefined;
  }
  const prefix = `cook-${sessionId}-`;
  const match = names.find((n) => n.startsWith(prefix) && n.endsWith('.jsonl'));
  if (match === undefined) return undefined;
  return joinPath(dir, match);
}

function readJournalEntries(
  file: string,
  readFileSyncFn: typeof readFileSync,
): readonly JournalEntry[] {
  let raw: string;
  try {
    raw = readFileSyncFn(file, 'utf8');
  } catch {
    return [];
  }
  const out: JournalEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line) as JournalEntry);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

/**
 * Pure decision function — given the recorded execution-state on disk +
 * the journal + a PidChecker, decide whether a resume is warranted. Has
 * NO side effects; the caller (cookHandler) materializes the decision
 * (emit cook.resume, flip stale completed flag, abort, etc.).
 *
 * Test seam — `packages/cli/test/commands/cook-resume.test.ts` exercises
 * the four-condition truth table against synthetic journal fixtures.
 */
export function probeForResume(
  rootDir: string,
  deps: ProbeForResumeDeps & {
    readonly existsSyncFn?: typeof existsSync;
    readonly readFileSyncFn?: typeof readFileSync;
    readonly readdirSyncImpl?: (dir: string) => string[];
  } = {},
): ResumeDecision {
  const pidChecker = deps.pidChecker ?? defaultPidChecker;
  const existsSyncFn = deps.existsSyncFn ?? existsSync;
  const readFileSyncFn = deps.readFileSyncFn ?? readFileSync;

  let state: ExecutionStateRecord | null;
  try {
    state = readExecutionState(rootDir);
  } catch {
    // Corrupted state file — fail safe by treating it as no_state. The
    // operator's recourse is to delete the file (documented in
    // docs/operations/crash-recovery.md).
    return { kind: 'no_state' };
  }
  if (state === null) return { kind: 'no_state' };
  if (state.status === 'paused') return { kind: 'paused_resume' };
  if (state.status !== 'in_progress') {
    return { kind: 'fresh_run', reason: `prior_status_${state.status}` };
  }

  if (state.pid !== undefined) {
    const liveness = pidChecker(state.pid);
    if (liveness === 'alive' || liveness === 'unknown') {
      return { kind: 'abort_another_cook_running', pid: state.pid };
    }
  }

  const sessionId = state.session_id;
  if (sessionId === undefined) {
    return { kind: 'fresh_run', reason: 'no_session_id' };
  }

  const journalPath = findEventsFileForSession(
    rootDir,
    sessionId,
    existsSyncFn,
    deps.readdirSyncImpl,
  );
  if (journalPath === undefined) {
    return { kind: 'fresh_run', reason: 'no_journal' };
  }

  const entries = readJournalEntries(journalPath, readFileSyncFn);
  const completion = entries.find((e) => e.type === 'cook.completion');
  if (completion !== undefined) {
    return { kind: 'fresh_run', reason: 'prior_completed' };
  }

  // Find the last task_commit (high-water mark) and the last task_start
  // (in-flight task). If the last task_start has no matching task_commit
  // or task_complete, that's the task the crash interrupted — resume
  // points at THAT task (re-run from scratch), not the next one.
  let lastCommit: JournalEntry | undefined;
  let lastStart: JournalEntry | undefined;
  let lastComplete: JournalEntry | undefined;
  for (const e of entries) {
    if (e.type === 'cook.task_commit') lastCommit = e;
    if (e.type === 'cook.task_start') lastStart = e;
    if (e.type === 'cook.task_complete') lastComplete = e;
  }

  // If the last started task never reached complete/commit, resume points
  // at that task (re-run it). Otherwise resume points at the next task
  // (which the orchestrator's runMode will resolve — TS-side just surfaces
  // the high-water mark for observability).
  const fromTask =
    lastStart !== undefined &&
    (lastComplete === undefined || lastStart.task_id !== lastComplete.task_id) &&
    (lastCommit === undefined || lastStart.task_id !== lastCommit.task_id)
      ? (lastStart.task_id ?? 'unknown')
      : lastCommit !== undefined && lastCommit.task_id !== undefined
        ? `${lastCommit.task_id}_next`
        : (lastStart?.task_id ?? 'unknown');

  return {
    kind: 'resume',
    fromTask,
    lastCommitHash: lastCommit?.commit_hash,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Mode + RoutingDecision types
// ────────────────────────────────────────────────────────────────────────────

export type CookMode =
  | 'bootstrap'
  | 'scope'
  | 'discuss'
  | 'assumptions'
  | 'plan'
  | 'execute'
  | 'plan-and-execute'
  | 'verify'
  | 'uat-remediation'
  | 'qa-remediation'
  | 'milestone-uat-recovery'
  | 'add-phase'
  | 'insert-phase'
  | 'remove-phase'
  | 'archive';

/**
 * Phase 02 / Plan 02-01 — sentinel substituted into cook.md's
 * `${SEED_IDEA}` placeholder when the dashboard cook bar's seed file
 * (`.swt-planning/.pending-scope-idea.txt`) is absent, unreadable, or
 * empty after trim. The Scope prompt branches on this exact literal
 * string textually (see `commands/cook.md` Scope Step 2). Single-sourced
 * so tests and future remediation rounds can reuse the same value.
 */
export const SEED_IDEA_SENTINEL = '(no idea provided yet)';

/** Map of CookMode to the `### Mode: …` heading text inside commands/cook.md. */
export const MODE_HEADING: Readonly<Record<CookMode, string>> = {
  bootstrap: '### Mode: Bootstrap',
  scope: '### Mode: Scope',
  discuss: '### Mode: Discuss',
  assumptions: '### Mode: Assumptions',
  plan: '### Mode: Plan',
  execute: '### Mode: Execute',
  'plan-and-execute': '### Mode: Plan', // plan+execute reuses Plan mode body
  verify: '### Mode: Verify',
  'uat-remediation': '### Mode: UAT Remediation',
  'qa-remediation': '### Mode: UAT Remediation', // no QA Remediation heading in cook.md today; rolled into UAT Remediation
  'milestone-uat-recovery': '### Mode: Milestone UAT Recovery',
  'add-phase': '### Mode: Add Phase',
  'insert-phase': '### Mode: Insert Phase',
  'remove-phase': '### Mode: Remove Phase',
  archive: '### Mode: Archive',
};

export interface ModeOptions {
  readonly effort?: 'thorough' | 'balanced' | 'fast' | 'turbo';
  readonly skipQa: boolean;
  readonly skipAudit: boolean;
  readonly yolo: boolean;
  readonly planTarget?: string; // --plan=NN
  readonly phaseTarget?: number; // bare integer N
}

export interface RoutingDecision {
  readonly mode: CookMode;
  readonly priority: number;
  readonly requiresConfirmation: boolean;
  readonly confirmationQuestion?: string;
  readonly phaseTarget?: string; // "01"-padded phase number
}

// TEST SEAM — Phase 5 plan 05-02. Role-to-routing pin table for
// SWT_DEBUG_ONLY_ROLE. See the per-agent parity tests under
// test/regression/agent-parity/. Each entry maps an SWT agent role to the
// CookMode + priority that role's parity test should invoke. Not exported
// as a public API surface — only consumed at the routeFromPhaseDetect()
// callsite below when the env-var seam fires.
export type DebugOnlyRole = 'scout' | 'architect' | 'lead' | 'dev' | 'qa' | 'debugger' | 'docs';

export const ROLE_TO_ROUTING: Readonly<
  Record<DebugOnlyRole, { readonly mode: CookMode; readonly priority: number }>
> = {
  scout: { mode: 'scope', priority: 6 },
  architect: { mode: 'discuss', priority: 8 },
  lead: { mode: 'plan-and-execute', priority: 9 },
  dev: { mode: 'execute', priority: 10 },
  qa: { mode: 'verify', priority: 7 },
  debugger: { mode: 'qa-remediation', priority: 3.5 },
  docs: { mode: 'archive', priority: 11 },
};

// ────────────────────────────────────────────────────────────────────────────
// QA gate types — Task 4 (TDD3 §7.5)
// ────────────────────────────────────────────────────────────────────────────

export type QaReasonLabel =
  | 'missing_verification_artifact'
  | 'verification_result_missing'
  | 'verification_result_unrecognized'
  | 'qa_gate_rerun_required'
  | 'qa_gate_output_missing'
  | 'working_tree_changed'
  | 'verified_at_commit_mismatch'
  | 'git_status_failed'
  | 'git_log_failed'
  | 'product_commit_unavailable'
  | 'product_changed_after_verification'
  | 'freshness_baseline_unavailable';

export type QaGateDecision =
  | { readonly kind: 'proceed_to_uat' }
  | { readonly kind: 'run_qa_inline'; readonly reason: QaReasonLabel | string }
  | { readonly kind: 'init_qa_remediation' }
  | { readonly kind: 'qa_rerun_required'; readonly attemptCount: number };

export interface QaGateOverrides {
  readonly qa_gate_known_issues_override?: boolean;
  readonly qa_gate_deviation_override?: boolean;
  readonly qa_gate_metadata_only_override?: boolean;
  readonly qa_gate_process_exception_evidence_missing?: boolean;
  readonly qa_gate_round_change_evidence_empty?: boolean;
  readonly qa_gate_round_change_evidence_unavailable?: boolean;
}

/**
 * Plan 06-02 T4 (REQ-15) — provider router/fallback config block.
 *
 * Loaded from `.swt-planning/config.json#providers`. Defaults preserve
 * today's single-provider behavior: `{strategy: {kind:'pinned', provider:
 * 'anthropic'}, fallbacks: [], retryBudget: 3, timeBudgetMs: 30000}` —
 * the empty fallbacks list makes the chain degenerate (no fallback hops).
 *
 * The `strategy` block mirrors `RouterStrategy` from
 * `@swt-labs/orchestration/provider-router`. Kept type-narrow here so the
 * cook callsite can read it without pulling the orchestration package's
 * full type surface into the public CLI config.
 */
export type CookProviderStrategy =
  | { readonly kind: 'pinned'; readonly provider: string }
  | { readonly kind: 'round-robin'; readonly providers: readonly string[] }
  | {
      readonly kind: 'tier-routed';
      readonly map: Readonly<Record<string, string>>;
      readonly fallback: string;
    }
  | {
      readonly kind: 'cost-optimized';
      readonly providers: readonly string[];
      readonly priceTable: Readonly<Record<string, number>>;
    }
  | {
      /**
       * Phase 2 / G-R3 (plan 02-02) — picks the cheapest provider by
       * looking up per-1k pricing in a schema-validated `RateCard` loaded
       * by `@swt-labs/runtime`'s `createRateCardSource` (plan 02-01).
       * Strictly opt-in — `DEFAULT_PROVIDERS_CONFIG` stays at `pinned`.
       *
       * Cook callers populate `rateCard` from
       * `createRateCardSource({cwd}).readCurrent()` BEFORE handing the
       * strategy to `runSpawnWithFallback`. The router itself is pure —
       * no IO at selection time.
       */
      readonly kind: 'cost-optimized-rate-card';
      readonly providers: readonly string[];
      readonly rateCard: RateCard;
      readonly dimension: 'input' | 'output' | 'blended';
      readonly model?: string;
    }
  | {
      /**
       * Phase 2 / G-R3 R2 (plan 02-03) — tier-routed with the wider
       * compound tier vocabulary (10 strings, see
       * `packages/orchestration/src/provider-router.ts:CompoundTier`).
       *
       * `map` is `Record<string, string>` at the config layer because
       * JSON-loaded keys are stringly-typed; `toRouterStrategy` filters
       * against `validCompoundTiers` (10-entry literal array) before
       * mapping to the router shape's narrower
       * `Partial<Record<CompoundTier, string>>`.
       *
       * `fallbackStrategy` is OPEN recursive at the config layer
       * (allows any `CookProviderStrategy`); the router-layer Exclude<...>
       * bound on RouterStrategy.tier-routed-compound.fallbackStrategy
       * catches nested `tier-routed-compound` configs at the
       * `toRouterStrategy` mapping boundary (R3 bounded depth-1).
       */
      readonly kind: 'tier-routed-compound';
      readonly map: Readonly<Record<string, string>>;
      readonly fallback: string;
      readonly fallbackStrategy?: CookProviderStrategy;
    };

export interface CookProvidersConfig {
  readonly strategy: CookProviderStrategy;
  readonly fallbacks: readonly string[];
  readonly retryBudget: number;
  readonly timeBudgetMs: number;
}

export const DEFAULT_PROVIDERS_CONFIG: CookProvidersConfig = {
  strategy: { kind: 'pinned', provider: 'anthropic' },
  fallbacks: [],
  retryBudget: 3,
  timeBudgetMs: 30_000,
};

/**
 * Plan 06-02 T4 (REQ-16) — milestone budget config block. Loaded from
 * `.swt-planning/config.json#budget`. Falls back to safe defaults so cook
 * runs continue when the user hasn't authored a budget block:
 *
 *   - `milestone_usd: 10` — generous ceiling that lets typical
 *     development sessions complete without paging the gate.
 *   - `tier_downgrade_threshold: 0.7` — first warning at 70% (matches
 *     ADR-007 §M4 + research §4.3).
 *   - `pause_threshold: 0.95` — pause at 95% (the milestone-budget cap
 *     before runaway-spend triggers).
 *
 * `BudgetConfigSchemaT` from `@swt-labs/shared` is the canonical shape
 * — we mirror its required fields and let Zod parse on load.
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfigSchemaT = {
  schema_version: 1,
  milestone_usd: 10,
  tier_downgrade_threshold: 0.7,
  pause_threshold: 0.95,
  // Plan 03-03 added `projection_enabled` as a required schema field
  // (default true / G-R4). Mirror that default here so the safe-fallback
  // config keeps pre-spawn projection on unless an operator opts out.
  projection_enabled: true,
};

/**
 * Cook configuration (subset of `.swt-planning/config.json` the cook handler
 * reads). Tests inject the shape; production reads from disk via
 * `loadCookConfig`.
 */
export interface CookConfig {
  readonly auto_uat: boolean;
  readonly agent_max_turns_orchestrator?: number;
  readonly qa_gate_overrides?: QaGateOverrides;
  readonly providers: CookProvidersConfig;
  readonly budget: BudgetConfigSchemaT;
  /**
   * Plan 06-03 T1 (R6) — git-worktree isolation for parallel teammate
   * spawns. `'off'` (default for v3.0) preserves today's shared-working-
   * tree behavior with the Phase 4 Wave 2 git-staging race risk. `'on'`
   * forces a per-task `.swt-planning/parallel/wt-<taskId>/` worktree
   * via `WorktreeManager`. `'auto'` is the same as `'on'` when the
   * active phase carries 2+ same-wave plans, `'off'` otherwise.
   *
   * v3.0 keeps `'off'`; flip to `'on'` is gated on 30-day stability
   * evidence per R6.
   */
  readonly worktree_isolation: 'off' | 'on' | 'auto';
  /**
   * Plan 02-04 (Phase 2 / Selection → Spawn Wiring) — the additive `auth`
   * config block: per-provider `{mode, credentialRef?}` entries describing
   * HOW each provider authenticates. Parsed by {@link parseAuthConfig} from
   * the `auth` sub-key of `.swt-planning/config.json` — a sub-key entirely
   * SEPARATE from `providers.strategy` (which is routing, not credentials).
   * ALWAYS present: `DEFAULT_AUTH_CONFIG` (`{}`) when no `auth` block is
   * configured or the config is malformed, so the cook spawn callsite never
   * has to guard for `undefined`. An empty `auth` block ⇒ behaviour is
   * byte-identical to pre-Phase-2 (the spawn resolves no credential and Pi
   * falls through to its own auth resolution).
   */
  readonly auth: AuthConfig;
}

// ────────────────────────────────────────────────────────────────────────────
// Pre-parse: ref tag extraction + todo number resolution placeholder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract a trailing `(ref:XXXXXXXX)` suffix (8 hex chars) from the args.
 * Returns the stripped args + the extracted hash. If no ref tag is present,
 * returns the args unchanged + `undefined` hash.
 */
export function extractRefTag(args: string): { args: string; refHash: string | undefined } {
  const refMatch = args.match(/\s*\(ref:([0-9a-f]{8})\)\s*$/i);
  if (refMatch === null) {
    return { args, refHash: undefined };
  }
  return {
    args: args.slice(0, refMatch.index).trimEnd(),
    refHash: refMatch[1]!.toLowerCase(),
  };
}

/**
 * Resolve a bare integer arg to a todo. Stub for Phase 3 — when the
 * `.swt-planning/.last-list-todos-snapshot.json` exists with `filter=null`,
 * call `scripts/resolve-todo-item.sh`; otherwise treat the integer as a
 * phase number.
 *
 * This is INTENTIONALLY a stub — the snapshot lifecycle is a Phase 7 swt
 * todo concern, not a Phase 3 orchestrator concern. The plan documents
 * the pickup boundary (claim only after confirmation succeeds), but the
 * todo-pickup integration ships with Plan 07-* when `swt todo` lands.
 *
 * For Phase 3, the cook handler treats a bare integer as a phase target
 * — which is the dominant code path. Tests for the todo branch can be
 * added when `swt todo` materializes.
 */
export function resolveTodoNumber(
  args: string,
  _cwd: string,
): { args: string; phaseTarget?: number; todoSelected?: false } {
  const trimmed = args.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return { args };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return { args };
  return { args, phaseTarget: n, todoSelected: false };
}

// ────────────────────────────────────────────────────────────────────────────
// Path 1: flag detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Inspect the parsed flags for a mode flag. Returns the mode + ModeOptions
 * when found, otherwise undefined. Flag-detected modes skip the
 * confirmation gate (flags express explicit intent — TDD3 §7.2).
 */
export function detectModeFromFlags(
  flags: Readonly<Record<string, string | boolean | undefined>>,
): { mode: CookMode; opts: ModeOptions } | undefined {
  const skipQa = flags['skip-qa'] === true;
  const skipAudit = flags['skip-audit'] === true;
  const yolo = flags['yolo'] === true;
  const effort = normaliseEffort(flags['effort']);
  // --plan can be either a boolean (`--plan`) or a string (`--plan 03`,
  // `--plan=01`). parseArgs gives us a string when present with a value,
  // boolean when bare — but the global argv defines it as 'string' only
  // (legacy). When --plan is unset, flags.plan is undefined. When set
  // bare it lands as '' (rare); when set with NN it's '01' etc.
  const planFlag = flags['plan'];
  const planTarget = typeof planFlag === 'string' && planFlag.length > 0 ? planFlag : undefined;
  const baseOpts: ModeOptions = {
    skipQa,
    skipAudit,
    yolo,
    ...(effort !== undefined ? { effort } : {}),
    ...(planTarget !== undefined ? { planTarget } : {}),
  };

  // Flag priority matches the order in commands/cook.md "Path 1: Flag
  // detection" (TDD3 §7.2). First match wins.
  if (planFlag !== undefined) return { mode: 'plan', opts: baseOpts };
  if (flags['execute'] === true) return { mode: 'execute', opts: baseOpts };
  if (flags['discuss'] === true) return { mode: 'discuss', opts: baseOpts };
  if (flags['assumptions'] === true) return { mode: 'assumptions', opts: baseOpts };
  if (flags['scope'] === true) return { mode: 'scope', opts: baseOpts };
  if (typeof flags['add'] === 'string') return { mode: 'add-phase', opts: baseOpts };
  if (typeof flags['insert'] === 'string') return { mode: 'insert-phase', opts: baseOpts };
  if (typeof flags['remove'] === 'string') return { mode: 'remove-phase', opts: baseOpts };
  if (flags['verify'] === true) return { mode: 'verify', opts: baseOpts };
  if (flags['archive'] === true) return { mode: 'archive', opts: baseOpts };
  return undefined;
}

function normaliseEffort(raw: string | boolean | undefined): ModeOptions['effort'] | undefined {
  if (typeof raw !== 'string') return undefined;
  switch (raw) {
    case 'thorough':
    case 'balanced':
    case 'fast':
    case 'turbo':
      return raw;
    default:
      return undefined;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Path 2: natural-language intent routing
// ────────────────────────────────────────────────────────────────────────────

const NL_KEYWORD_TABLE: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly mode: CookMode;
}> = [
  { pattern: /\b(talk|discuss|explore|think about|what about)\b/i, mode: 'discuss' },
  { pattern: /\b(assume|assuming|what if|what are you assuming)\b/i, mode: 'assumptions' },
  { pattern: /\b(plan|scope|break down|decompose|structure)\b/i, mode: 'plan' },
  { pattern: /\b(build|execute|run|do it|go|make it|ship it)\b/i, mode: 'execute' },
  { pattern: /\b(verify|test|uat|check my work|acceptance test|walk through)\b/i, mode: 'verify' },
  { pattern: /\b(add|insert|remove|skip|drop|new phase)\b/i, mode: 'add-phase' },
  { pattern: /\b(done|ship|archive|wrap up|finish|complete)\b/i, mode: 'archive' },
];

export function detectModeFromNaturalLanguage(args: string): CookMode | undefined {
  for (const entry of NL_KEYWORD_TABLE) {
    if (entry.pattern.test(args)) return entry.mode;
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Path 3: state-driven routing (the 11-priority table)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Apply the 11-priority routing table to a `PhaseDetectResult`. Returns the
 * resolved routing decision (or `undefined` for priority 1, which short-
 * circuits to "Run swt init first" — surfaced as a separate code path
 * because no Pi spawn is required).
 *
 * Fallback patterns (TDD3 §7.4) are applied here in TS, NOT inside the
 * mode prompts.
 */
export function routeFromPhaseDetect(
  state: PhaseDetectResult,
  config: CookConfig,
): RoutingDecision | { kind: 'init-required' } {
  // Priority 1 — planning_dir_exists=false → init redirect
  if (!state.planning_dir_exists) {
    return { kind: 'init-required' };
  }

  // Priority 2 — project_exists=false → Bootstrap (gated)
  if (!state.project_exists) {
    return {
      mode: 'bootstrap',
      priority: 2,
      requiresConfirmation: true,
      confirmationQuestion: 'No project defined. Set one up?',
    };
  }

  const nextPhase = state.next_phase ?? '';

  // Priority 3 — needs_uat_remediation (auto_uat gates confirmation)
  if (state.next_phase_state === 'needs_uat_remediation') {
    return {
      mode: 'uat-remediation',
      priority: 3,
      requiresConfirmation: !config.auto_uat,
      confirmationQuestion: `Phase ${nextPhase} has unresolved UAT issues. Continue with remediation now?`,
      ...(nextPhase !== '' ? { phaseTarget: nextPhase } : {}),
    };
  }

  // Priority 3.5 — needs_qa_remediation (auto_uat gates confirmation)
  if (state.next_phase_state === 'needs_qa_remediation') {
    return {
      mode: 'qa-remediation',
      priority: 3.5,
      requiresConfirmation: !config.auto_uat,
      confirmationQuestion: `Phase ${nextPhase} has QA failures. Continue with QA remediation?`,
      ...(nextPhase !== '' ? { phaseTarget: nextPhase } : {}),
    };
  }

  // Priority 4 — needs_reverification (auto_uat gates confirmation)
  if (state.next_phase_state === 'needs_reverification') {
    return {
      mode: 'verify',
      priority: 4,
      requiresConfirmation: !config.auto_uat,
      confirmationQuestion: `Phase ${nextPhase} remediation complete. Run re-verification?`,
      ...(nextPhase !== '' ? { phaseTarget: nextPhase } : {}),
    };
  }

  // Priority 5 — milestone_uat_issues=true (mode handles its own confirmation)
  if (state.milestone_uat_issues) {
    return {
      mode: 'milestone-uat-recovery',
      priority: 5,
      requiresConfirmation: false,
    };
  }

  // Priority 6 — phase_count=0 → Scope (gated)
  if (state.phase_count === 0 || state.next_phase_state === 'phase_count_zero') {
    return {
      mode: 'scope',
      priority: 6,
      requiresConfirmation: true,
      confirmationQuestion: 'Project defined but no phases. Scope the work?',
    };
  }

  // Priority 7 — needs_verification → QA gate runs BEFORE entering verify
  if (state.next_phase_state === 'needs_verification') {
    return {
      mode: 'verify',
      priority: 7,
      requiresConfirmation: false,
      ...(nextPhase !== '' ? { phaseTarget: nextPhase } : {}),
    };
  }

  // Priority 8 — needs_discussion (gated)
  if (state.next_phase_state === 'needs_discussion') {
    // Fallback (TDD3 §7.4): if first_qa_attention_phase + failed,
    // re-target into QA Remediation rather than discussing unrelated work.
    if (state.first_qa_attention_phase !== undefined && state.qa_attention_status === 'failed') {
      return {
        mode: 'qa-remediation',
        priority: 8,
        requiresConfirmation: !config.auto_uat,
        confirmationQuestion: `Phase ${state.first_qa_attention_phase} has QA failures. Continue with QA remediation?`,
        phaseTarget: state.first_qa_attention_phase,
      };
    }
    return {
      mode: 'discuss',
      priority: 8,
      requiresConfirmation: true,
      confirmationQuestion: `Phase ${nextPhase} needs discussion before planning. Start discussion?`,
      ...(nextPhase !== '' ? { phaseTarget: nextPhase } : {}),
    };
  }

  // Priority 9 — needs_plan_and_execute (gated)
  if (state.next_phase_state === 'needs_plan_and_execute') {
    if (state.first_qa_attention_phase !== undefined && state.qa_attention_status === 'failed') {
      return {
        mode: 'qa-remediation',
        priority: 9,
        requiresConfirmation: !config.auto_uat,
        confirmationQuestion: `Phase ${state.first_qa_attention_phase} has QA failures. Continue with QA remediation?`,
        phaseTarget: state.first_qa_attention_phase,
      };
    }
    return {
      mode: 'plan-and-execute',
      priority: 9,
      requiresConfirmation: true,
      confirmationQuestion: `Phase ${nextPhase} needs planning and execution. Start?`,
      ...(nextPhase !== '' ? { phaseTarget: nextPhase } : {}),
    };
  }

  // Priority 10 — needs_execute (gated)
  if (state.next_phase_state === 'needs_execute') {
    if (state.first_qa_attention_phase !== undefined && state.qa_attention_status === 'failed') {
      return {
        mode: 'qa-remediation',
        priority: 10,
        requiresConfirmation: !config.auto_uat,
        confirmationQuestion: `Phase ${state.first_qa_attention_phase} has QA failures. Continue with QA remediation?`,
        phaseTarget: state.first_qa_attention_phase,
      };
    }
    return {
      mode: 'execute',
      priority: 10,
      requiresConfirmation: true,
      confirmationQuestion: `Phase ${nextPhase} is planned. Execute it?`,
      ...(nextPhase !== '' ? { phaseTarget: nextPhase } : {}),
    };
  }

  // Priority 11 — all_done. Honour QA-attention pending fallback first:
  // re-target to verify of the qa-attention phase rather than archiving.
  if (state.next_phase_state === 'all_done') {
    if (state.first_qa_attention_phase !== undefined && state.qa_attention_status === 'pending') {
      return {
        mode: 'verify',
        priority: 11,
        requiresConfirmation: false,
        phaseTarget: state.first_qa_attention_phase,
      };
    }
    return {
      mode: 'archive',
      priority: 11,
      requiresConfirmation: true,
      confirmationQuestion: 'All phases complete. Run audit and archive?',
    };
  }

  // Unreachable per the NextPhaseState union — return a defensive Bootstrap
  // gate so the orchestrator never silently no-ops.
  return {
    mode: 'bootstrap',
    priority: 2,
    requiresConfirmation: true,
    confirmationQuestion: 'Project state is ambiguous. Re-bootstrap?',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// QA gate — Task 4 (TDD3 §7.5)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate the QA gate state BEFORE entering Verify mode. Pure TypeScript;
 * no LLM. The 12 `qa_reason` labels each have a routing rule; the 6
 * override flags can convert a `run_qa_inline` decision into
 * `proceed_to_uat` (TDD3 §7.5 + Plan 03-02 R5).
 *
 * Override flag effects:
 *   - qa_gate_known_issues_override: skip QA when the only outstanding
 *     verification issue is the known-issues backlog (operator-judged
 *     acceptable risk).
 *   - qa_gate_deviation_override: skip QA when the verification result
 *     was 'unrecognized' because the verifier wrote a non-standard label.
 *   - qa_gate_metadata_only_override: skip QA when the only diff is in
 *     metadata files (CHANGELOG, etc.) — proves no product change.
 *   - qa_gate_process_exception_evidence_missing: skip QA when freshness
 *     evidence is missing AND the operator has documented a process
 *     exception in the round-change evidence file.
 *   - qa_gate_round_change_evidence_empty: skip QA when the round-change
 *     evidence file exists but is empty (audit trail intentionally cleared).
 *   - qa_gate_round_change_evidence_unavailable: skip QA when the
 *     round-change evidence file cannot be read (operator-side limitation).
 */
export function evaluateQaGate(
  state: PhaseDetectResult,
  config: CookConfig,
  attemptCount = 0,
): QaGateDecision {
  // Dormant after UAT cutover OR explicit uat_cutover marker → proceed.
  const qaReasonLower = (state.qa_reason ?? '').toLowerCase();
  if (qaReasonLower === 'uat_cutover') {
    return { kind: 'proceed_to_uat' };
  }

  switch (state.qa_status) {
    case 'passed':
    case 'remediated':
      return { kind: 'proceed_to_uat' };
    case 'failed':
      return { kind: 'init_qa_remediation' };
    case 'remediating':
      // Defensive — phase-detect should have routed away from priority 7.
      // Surface as init_qa_remediation so the loop converges on
      // remediation rather than spinning.
      return { kind: 'init_qa_remediation' };
    case 'pending': {
      const overrides = config.qa_gate_overrides ?? {};
      // Each override flag converts the run_qa_inline decision into
      // proceed_to_uat when the matching qa_reason matches its scope.
      // See TDD3 §7.5 — override scope is intentionally narrow to keep
      // operator escape hatches auditable.
      if (overrides.qa_gate_known_issues_override === true) {
        return { kind: 'proceed_to_uat' };
      }
      if (
        overrides.qa_gate_deviation_override === true &&
        qaReasonLower === 'verification_result_unrecognized'
      ) {
        return { kind: 'proceed_to_uat' };
      }
      if (
        overrides.qa_gate_metadata_only_override === true &&
        qaReasonLower === 'product_changed_after_verification'
      ) {
        return { kind: 'proceed_to_uat' };
      }
      if (
        overrides.qa_gate_process_exception_evidence_missing === true &&
        qaReasonLower === 'freshness_baseline_unavailable'
      ) {
        return { kind: 'proceed_to_uat' };
      }
      if (overrides.qa_gate_round_change_evidence_empty === true) {
        return { kind: 'proceed_to_uat' };
      }
      if (overrides.qa_gate_round_change_evidence_unavailable === true) {
        return { kind: 'proceed_to_uat' };
      }

      // Bounded retry — qa_rerun_required cycles back to run_qa_inline up
      // to 2 retries before surfacing OPERATION_FAILED.
      if (qaReasonLower === 'qa_gate_rerun_required' && attemptCount > 0) {
        return { kind: 'qa_rerun_required', attemptCount };
      }
      return {
        kind: 'run_qa_inline',
        reason: state.qa_reason ?? 'qa_gate_output_missing',
      };
    }
    case 'none':
    default:
      // qa_status='none' means no QA evidence exists yet — run inline so
      // the verify path has fresh evidence.
      return { kind: 'run_qa_inline', reason: 'qa_gate_output_missing' };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Command-body loading + section extraction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Strip the YAML frontmatter (leading `---\n...\n---\n`) from a markdown
 * document. Returns the body. If no frontmatter is present, returns the
 * input unchanged.
 */
export function stripFrontmatter(md: string): string {
  if (!md.startsWith('---\n')) return md;
  const closeIdx = md.indexOf('\n---\n', 4);
  if (closeIdx === -1) return md;
  return md.slice(closeIdx + 5);
}

/**
 * alpha.22 — pattern-match upstream LLM-API failures we have a known SWT-
 * specific story for, and prepend a short actionable note above the raw
 * error body. Currently handles the Anthropic Max-plan OAuth "out of
 * extra usage" case (third-party tools' OAuth requests hit Anthropic's
 * separate `extra_usage` billing pool, which is empty by default until
 * Anthropic adds Pi's OAuth client_id to their Max-routing allowlist).
 *
 * The raw error stays in the output verbatim — we ONLY prepend context.
 * Callers pass `result.summary` from a failed dispatcher TaskResult; this
 * function returns the augmented string for stderr surfacing in both
 * `cook` and `init`. Lookups are substring-based so the function is
 * resilient to Anthropic's error-string drift (e.g. wording changes).
 *
 * Exported for `init.ts`. Tested via `cook-error-augmenter.test.ts`.
 */
export function augmentSpawnError(rawSummary: string | undefined): string {
  if (rawSummary === undefined || rawSummary.length === 0) return '';
  // Anthropic Max-plan OAuth → third-party OAuth `extra_usage` pool.
  // Pi (and therefore SWT) sends `claude-code-20250219` + `oauth-2025-04-20`
  // + `x-app: cli` + `user-agent: claude-cli/<v>` on every OAuth request,
  // so the wire format is byte-identical to Claude Code's own. The block
  // is Anthropic's per-client_id allowlist — Pi authenticates as Pi's
  // OAuth client (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`), which is
  // separate from Anthropic's own internal Claude Code client. Until that
  // client_id is added to the Max-routing allowlist, OAuth requests bill
  // against the empty `extra_usage` pool → 400 "out of extra usage".
  if (/out of extra usage/i.test(rawSummary)) {
    return (
      `Anthropic returned "out of extra usage" — your OAuth token authenticated successfully,\n` +
      `but the request was routed to Anthropic's third-party OAuth billing pool (empty by default)\n` +
      `instead of your Max plan's interactive quota. SWT/Pi sends the correct Claude Code\n` +
      `identification headers; the bottleneck is Anthropic's per-client_id allowlist.\n` +
      `\n` +
      `Workarounds:\n` +
      `  • Add an Anthropic API key via the dashboard's Provider menu (works today,\n` +
      `    bills your Console account separately from Max).\n` +
      `  • Or set ANTHROPIC_API_KEY in your shell env.\n` +
      `\n` +
      `Long-term: Anthropic must allowlist Pi's OAuth client_id\n` +
      `(\`9d1c250a-e61b-44d9-88ed-5944d1962f5e\`) for Max-plan routing.\n` +
      `\n` +
      `Raw Anthropic response: ${rawSummary}`
    );
  }
  return rawSummary;
}

/**
 * Extract a `### Mode: …` section from `commands/cook.md`. The slice runs
 * from the matching heading to the NEXT `### Mode:` heading (exclusive) or
 * EOF, whichever comes first.
 */
export function extractModeSection(body: string, modeHeading: string): string {
  const startIdx = body.indexOf(modeHeading);
  if (startIdx === -1) {
    throw new Error(`cook: could not find mode section "${modeHeading}" in commands/cook.md`);
  }
  const afterStart = startIdx + modeHeading.length;
  const nextIdx = body.indexOf('\n### Mode:', afterStart);
  return nextIdx === -1 ? body.slice(startIdx) : body.slice(startIdx, nextIdx);
}

/**
 * Substitute placeholder strings (`${SWT_INSTALL_ROOT}`,
 * `${SWT_PHASE_DETECT_OUTPUT}`, `${SEED_IDEA}`) in the prompt body. Other
 * placeholders pass through unmodified for the LLM to interpret.
 *
 * Phase 02 / Plan 02-01 — `seedIdea` is the contents of
 * `.swt-planning/.pending-scope-idea.txt` (the dashboard cook bar's seed
 * text), or the sentinel `(no idea provided yet)` when the file is absent
 * or unreadable. TS owns the sentinel substitution; the prompt body in
 * `cook.md` branches textually on the literal sentinel string (separation
 * per 02-CONTEXT.md: human-editable prompt, no conditional logic in TS).
 */
export function substitutePlaceholders(
  body: string,
  installRoot: string,
  phaseDetectOutput: string,
  seedIdea: string,
): string {
  return body
    .replace(/\$\{SWT_INSTALL_ROOT\}/g, installRoot)
    .replace(/\$\{SWT_PHASE_DETECT_OUTPUT\}/g, phaseDetectOutput)
    .replace(/\$\{SEED_IDEA\}/g, seedIdea);
}

/**
 * Load the cook.md body, strip frontmatter, extract the right mode
 * section, and substitute placeholders. Returns the prompt that gets
 * passed into the orchestrator Pi session via spawnOrchestratorSession.
 */
export function loadCookModeSection(
  installRoot: string,
  mode: CookMode,
  phaseDetectOutput: string,
  seedIdea: string,
  fsImpl: { readFileSync: typeof readFileSync } = { readFileSync },
): string {
  const cookMdPath = resolvePath(installRoot, 'commands', 'cook.md');
  const raw = fsImpl.readFileSync(cookMdPath, 'utf8');
  const body = stripFrontmatter(raw);
  const heading = MODE_HEADING[mode];
  const section = extractModeSection(body, heading);
  return substitutePlaceholders(section, installRoot, phaseDetectOutput, seedIdea);
}

// ────────────────────────────────────────────────────────────────────────────
// Config loader
// ────────────────────────────────────────────────────────────────────────────

/**
 * Plan 06-02 T4 — parse the optional `providers` block from
 * `.swt-planning/config.json`. Returns DEFAULT_PROVIDERS_CONFIG when the
 * block is missing or malformed (best-effort; misconfigured values never
 * crash the cook handler — they fall back to defaults).
 */
function parseProvidersConfig(raw: unknown): CookProvidersConfig {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PROVIDERS_CONFIG;
  const block = raw as Record<string, unknown>;
  const strategy = parseStrategy(block['strategy']);
  const fallbacks = Array.isArray(block['fallbacks'])
    ? (block['fallbacks'] as unknown[]).filter((s): s is string => typeof s === 'string')
    : DEFAULT_PROVIDERS_CONFIG.fallbacks;
  const retryBudget =
    typeof block['retryBudget'] === 'number' &&
    Number.isFinite(block['retryBudget']) &&
    block['retryBudget'] >= 1
      ? block['retryBudget']
      : DEFAULT_PROVIDERS_CONFIG.retryBudget;
  const timeBudgetMs =
    typeof block['timeBudgetMs'] === 'number' &&
    Number.isFinite(block['timeBudgetMs']) &&
    block['timeBudgetMs'] > 0
      ? block['timeBudgetMs']
      : DEFAULT_PROVIDERS_CONFIG.timeBudgetMs;
  return { strategy, fallbacks, retryBudget, timeBudgetMs };
}

/**
 * Plan 06-02 T4 — parse the optional `budget` block from
 * `.swt-planning/config.json`. Returns DEFAULT_BUDGET_CONFIG on missing or
 * malformed input. Best-effort: misconfigured values never crash the cook
 * handler — they fall back to defaults (mirrors providers config parsing).
 */
function parseBudgetConfig(raw: unknown): BudgetConfigSchemaT {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_BUDGET_CONFIG;
  const block = raw as Record<string, unknown>;
  const milestone =
    typeof block['milestone_usd'] === 'number' && block['milestone_usd'] > 0
      ? block['milestone_usd']
      : DEFAULT_BUDGET_CONFIG.milestone_usd;
  const downgrade =
    typeof block['tier_downgrade_threshold'] === 'number' &&
    block['tier_downgrade_threshold'] >= 0 &&
    block['tier_downgrade_threshold'] <= 1
      ? block['tier_downgrade_threshold']
      : DEFAULT_BUDGET_CONFIG.tier_downgrade_threshold;
  const pause =
    typeof block['pause_threshold'] === 'number' &&
    block['pause_threshold'] >= 0 &&
    block['pause_threshold'] <= 1
      ? block['pause_threshold']
      : DEFAULT_BUDGET_CONFIG.pause_threshold;
  // Plan 03-03 added `projection_enabled` (required, default true) +
  // `projection_halt_threshold` (optional) to the budget schema. Parse both
  // best-effort — an explicit `false` disables the pre-spawn projection path
  // (G-R4); anything else keeps it on.
  const projectionEnabled =
    typeof block['projection_enabled'] === 'boolean'
      ? block['projection_enabled']
      : DEFAULT_BUDGET_CONFIG.projection_enabled;
  return {
    schema_version: 1,
    milestone_usd: milestone,
    tier_downgrade_threshold: downgrade,
    pause_threshold: pause,
    projection_enabled: projectionEnabled,
    ...(typeof block['phase_usd'] === 'number' && block['phase_usd'] > 0
      ? { phase_usd: block['phase_usd'] }
      : {}),
    ...(typeof block['task_usd'] === 'number' && block['task_usd'] > 0
      ? { task_usd: block['task_usd'] }
      : {}),
    ...(typeof block['projection_halt_threshold'] === 'number' &&
    block['projection_halt_threshold'] >= 0 &&
    block['projection_halt_threshold'] <= 1
      ? { projection_halt_threshold: block['projection_halt_threshold'] }
      : {}),
  };
}

function parseStrategy(raw: unknown): CookProviderStrategy {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PROVIDERS_CONFIG.strategy;
  const obj = raw as Record<string, unknown>;
  switch (obj['kind']) {
    case 'pinned':
      return typeof obj['provider'] === 'string'
        ? { kind: 'pinned', provider: obj['provider'] }
        : DEFAULT_PROVIDERS_CONFIG.strategy;
    case 'round-robin':
      return Array.isArray(obj['providers'])
        ? {
            kind: 'round-robin',
            providers: (obj['providers'] as unknown[]).filter(
              (s): s is string => typeof s === 'string',
            ),
          }
        : DEFAULT_PROVIDERS_CONFIG.strategy;
    case 'tier-routed':
      return typeof obj['map'] === 'object' &&
        obj['map'] !== null &&
        typeof obj['fallback'] === 'string'
        ? {
            kind: 'tier-routed',
            map: obj['map'] as Record<string, string>,
            fallback: obj['fallback'],
          }
        : DEFAULT_PROVIDERS_CONFIG.strategy;
    case 'cost-optimized':
      return Array.isArray(obj['providers']) &&
        typeof obj['priceTable'] === 'object' &&
        obj['priceTable'] !== null
        ? {
            kind: 'cost-optimized',
            providers: (obj['providers'] as unknown[]).filter(
              (s): s is string => typeof s === 'string',
            ),
            priceTable: obj['priceTable'] as Record<string, number>,
          }
        : DEFAULT_PROVIDERS_CONFIG.strategy;
    default:
      return DEFAULT_PROVIDERS_CONFIG.strategy;
  }
}

export function loadCookConfig(
  cwd: string,
  fsImpl: { readFileSync: typeof readFileSync; existsSync: typeof existsSync } = {
    readFileSync,
    existsSync,
  },
): CookConfig {
  const configPath = resolvePath(cwd, '.swt-planning', 'config.json');
  if (!fsImpl.existsSync(configPath)) {
    return {
      auto_uat: false,
      providers: DEFAULT_PROVIDERS_CONFIG,
      budget: DEFAULT_BUDGET_CONFIG,
      worktree_isolation: 'off',
      auth: DEFAULT_AUTH_CONFIG,
    };
  }
  try {
    const raw = fsImpl.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const autoUat = typeof parsed['auto_uat'] === 'boolean' ? parsed['auto_uat'] : false;
    const overrides =
      typeof parsed['qa_gate_overrides'] === 'object' && parsed['qa_gate_overrides'] !== null
        ? (parsed['qa_gate_overrides'] as QaGateOverrides)
        : undefined;
    const maxTurns =
      typeof parsed['agent_max_turns'] === 'object' && parsed['agent_max_turns'] !== null
        ? (parsed['agent_max_turns'] as Record<string, unknown>)['orchestrator']
        : undefined;
    const providers = parseProvidersConfig(parsed['providers']);
    const budget = parseBudgetConfig(parsed['budget']);
    const worktreeIsolation = parseWorktreeIsolation(parsed['worktree_isolation']);
    // Plan 02-04 (Phase 2) — parse the additive `auth` block alongside the
    // EXISTING `parseProvidersConfig(parsed['providers'])` call. Two
    // independent calls on two independent sub-keys; nothing about the
    // `providers` block changes — `auth` is purely additive.
    const authConfig = parseAuthConfig(parsed['auth']);
    return {
      auto_uat: autoUat,
      providers,
      budget,
      worktree_isolation: worktreeIsolation,
      auth: authConfig,
      ...(overrides !== undefined ? { qa_gate_overrides: overrides } : {}),
      ...(typeof maxTurns === 'number' && Number.isFinite(maxTurns)
        ? { agent_max_turns_orchestrator: maxTurns }
        : {}),
    };
  } catch {
    return {
      auto_uat: false,
      providers: DEFAULT_PROVIDERS_CONFIG,
      budget: DEFAULT_BUDGET_CONFIG,
      worktree_isolation: 'off',
      auth: DEFAULT_AUTH_CONFIG,
    };
  }
}

/**
 * Plan 06-03 T1 — parse `worktree_isolation` from `.swt-planning/config.json`.
 * Returns `'off'` (the v3.0 default per R6) for missing / malformed input;
 * misconfigured values never crash the cook handler.
 */
function parseWorktreeIsolation(raw: unknown): 'off' | 'on' | 'auto' {
  if (raw === 'on' || raw === 'auto' || raw === 'off') return raw;
  return 'off';
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level handler
// ────────────────────────────────────────────────────────────────────────────

/**
 * Plan 06-02 T4 — BudgetGate factory signature. Production wires it to
 * `createBudgetGate({config, meter: createFileMeterAdapter({metricsDir})})`.
 * Tests inject a hand-rolled fake whose `state()` and `subscribe()` are
 * deterministic (no chokidar fs watcher). Returns `null` to opt out of
 * budget gating entirely (legacy / test paths that don't care).
 */
export type BudgetGateFactory = (cfg: {
  readonly config: BudgetConfigSchemaT;
  readonly cwd: string;
}) => {
  readonly gate: BudgetGate;
  /** Optional async disposer (closes the chokidar watcher if present). */
  readonly dispose?: () => Promise<void> | void;
} | null;

/**
 * Production BudgetGate factory — wires `createFileMeterAdapter` against
 * `.swt-planning/.metrics/` (where 04-01's `recordUsage` writes the
 * session aggregates) and hands it to `createBudgetGate`. Returns `null`
 * (gate disabled) when the metrics dir cannot be opened — best-effort
 * gating, never blocks a cook turn on filesystem errors.
 */
const defaultBudgetGateFactory: BudgetGateFactory = ({ config, cwd }) => {
  try {
    const metricsDir = resolvePath(cwd, '.swt-planning', '.metrics');
    let adapter: FileMeterAdapter;
    try {
      adapter = createFileMeterAdapter({ metricsDir });
    } catch {
      return null;
    }
    const gate = createBudgetGate({ config, meter: adapter });
    return {
      gate,
      dispose: async () => {
        try {
          gate.dispose();
        } catch {
          // best-effort
        }
        try {
          await adapter.close();
        } catch {
          // best-effort
        }
      },
    };
  } catch {
    return null;
  }
};

/**
 * Plan 01-01 T2 — Conditional CLI positional → seed-file write.
 *
 * Called at each post-routing decision site (Path 1 flag, Path 2 NL,
 * Path 3 state-detection) BEFORE the corresponding `runMode(...)` call.
 * Writes `argsAfterTodo` to `.swt-planning/.pending-scope-idea.txt`
 * ONLY when the resolved CookMode is `scope` — the only mode whose
 * cook.md body branches on `${SEED_IDEA}` (per Plan 01-01 research Q2).
 *
 * Guards (ALL must hold to write):
 *   - argsAfterTodo.trim().length > 0     — non-whitespace positional
 *   - phaseTarget === undefined           — not `swt cook 3`
 *   - refHash === undefined               — not `swt cook (ref:HASH)`
 *   - resolvedMode === 'scope'            — only Scope reads ${SEED_IDEA}
 *
 * Newer-wins overwrite policy (per Plan 01-01 edge-case E decision):
 * when a non-empty seed file already exists, overwrite it AND emit a
 * stderr line `[cook] seed-file overwritten from CLI positional (was N
 * chars)`. Length-only logging — never echoes the prior content.
 *
 * Returns the newly-written trimmed seed text on a successful write, or
 * `undefined` when any guard fails (no write happens). Callers feed the
 * return into `RunModeContext.seedIdea` so the same cook invocation that
 * wrote the file sees the new value substituted into `${SEED_IDEA}`.
 */
function maybeWriteSeedFromPositional(args: {
  argsAfterTodo: string;
  phaseTarget: number | undefined;
  refHash: string | undefined;
  resolvedMode: CookMode;
  seedPath: string;
  existsSyncFn: typeof existsSync;
  readFileSyncFn: typeof readFileSync;
  writeFileSyncFn: typeof writeFileSync;
  io: CommandIO;
}): string | undefined {
  const trimmed = args.argsAfterTodo.trim();
  if (trimmed.length === 0) return undefined;
  if (args.phaseTarget !== undefined) return undefined;
  if (args.refHash !== undefined) return undefined;
  if (args.resolvedMode !== 'scope') return undefined;

  // Compute prior-length N (best-effort: any read failure → 0). The
  // stderr notice only fires when N > 0 so an absent-or-empty prior
  // seed is silently replaced.
  let priorLength = 0;
  if (args.existsSyncFn(args.seedPath)) {
    try {
      priorLength = Buffer.byteLength(args.readFileSyncFn(args.seedPath, 'utf8'), 'utf8');
    } catch {
      priorLength = 0;
    }
  }

  try {
    mkdirSync(dirname(args.seedPath), { recursive: true });
  } catch {
    // best-effort: writeFileSync below will surface a real error if the
    // dir truly doesn't exist after the mkdirSync attempt.
  }
  args.writeFileSyncFn(args.seedPath, trimmed, 'utf8');
  if (priorLength > 0) {
    args.io.stderr.write(
      `[cook] seed-file overwritten from CLI positional (was ${priorLength} chars)\n`,
    );
  }
  return trimmed;
}

/**
 * Dependency injection seam for tests. Production callers omit; tests
 * inject deterministic fakes.
 */
export interface CookHandlerDeps {
  readonly detectPhaseImpl?: typeof detectPhase;
  readonly askUserImpl?: typeof defaultAskUser;
  readonly spawnOrchestratorSessionImpl?: typeof spawnOrchestratorSession;
  readonly execSyncImpl?: typeof nodeExecSync;
  readonly readFileSyncImpl?: typeof readFileSync;
  readonly existsSyncImpl?: typeof existsSync;
  /**
   * Plan 01-01 T1 — Test seam for the CLI positional → seed-file write.
   * Production omits; tests inject `vi.fn()` so the conditional seed-write
   * at the Path-1/Path-2/Path-3 routing decision sites can be asserted
   * without touching the real filesystem. Parallels readFileSyncImpl /
   * existsSyncImpl above.
   */
  readonly writeFileSyncImpl?: typeof writeFileSync;
  /**
   * Plan 06-02 T4 — Test seam for BudgetGate construction. Production
   * omits; tests inject a fake gate so the runMode budget-gate wiring can
   * be exercised without a chokidar fs watcher.
   */
  readonly budgetGateFactory?: BudgetGateFactory;
}

/**
 * Build a CookHandler bound to a specific dependency set. The default
 * `cookHandler` export is the production-wired version; tests use
 * `makeCookHandler({ ... })` with injected deps.
 */
export function makeCookHandler(deps: CookHandlerDeps = {}): CommandHandler {
  const detectPhaseFn = deps.detectPhaseImpl ?? detectPhase;
  const askUserFn = deps.askUserImpl ?? defaultAskUser;
  const spawnFn = deps.spawnOrchestratorSessionImpl ?? spawnOrchestratorSession;
  const execSyncFn = deps.execSyncImpl ?? nodeExecSync;
  const readFileSyncFn = deps.readFileSyncImpl ?? readFileSync;
  const existsSyncFn = deps.existsSyncImpl ?? existsSync;
  const writeFileSyncFn = deps.writeFileSyncImpl ?? writeFileSync;
  const budgetGateFactoryFn = deps.budgetGateFactory ?? defaultBudgetGateFactory;

  return async (parsed, io: CommandIO): Promise<ExitCode> => {
    // 1. Compose the raw arguments string from positionals.
    const rawArgs = parsed.positionals.join(' ');
    const startTs = new Date().toISOString();

    // Plan 06-01 (Phase 6) T3 — resume probe at cookHandler entry. Runs
    // BEFORE the path-1 flag detection so a stale in_progress + dead pid
    // is surfaced before any spawn decision. The probe is a pure decision
    // function; we materialize the outcome here.
    const resumeDecision = probeForResume(io.cwd);
    if (resumeDecision.kind === 'abort_another_cook_running') {
      io.stderr.write(
        `swt cook: another cook session (pid ${resumeDecision.pid}) appears to be running ` +
          `against this project. Refusing to start a second cook. ` +
          `If the prior process is actually dead, delete .vbw-planning/.execution-state.json (or .swt-planning/.execution-state.json) and retry.\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }
    if (resumeDecision.kind === 'resume') {
      // Surface the resume on the events channel for the dashboard. The
      // sessionId we use here is whatever was recorded — we resolve it
      // again below, but for the cook.resume row we keep the recorded
      // session_id so the resume event lands in the same JSONL as the
      // crashed session's task_start row.
      const priorState = readExecutionState(io.cwd);
      if (priorState?.session_id !== undefined && priorState.started_at !== undefined) {
        emitCookEvent(io.cwd, priorState.session_id, priorState.started_at, {
          type: 'cook.resume',
          ts: new Date().toISOString(),
          session_id: priorState.session_id,
          from_task: resumeDecision.fromTask,
          ...(resumeDecision.lastCommitHash !== undefined
            ? { last_commit_hash: resumeDecision.lastCommitHash }
            : {}),
        });
      }
      // Flip the stale in_progress flag so the next probe (after THIS
      // invocation completes or crashes) starts from a clean slate. The
      // runMode below will overwrite this with its own fresh in_progress
      // record carrying the new pid + session_id.
      try {
        markCrashed(io.cwd);
      } catch {
        // best-effort
      }
    } else if (resumeDecision.kind === 'fresh_run' && resumeDecision.reason === 'prior_completed') {
      // Clean stale state — the prior session completed but never flipped
      // the flag (the markCompleted call swallows filesystem errors).
      try {
        markCompleted(io.cwd);
      } catch {
        // best-effort
      }
    }

    // 2. Pre-parse: ref tag extraction then todo / phase number resolution.
    const { args: argsAfterRef, refHash } = extractRefTag(rawArgs);
    const { args: argsAfterTodo, phaseTarget } = resolveTodoNumber(argsAfterRef, io.cwd);

    // 2.5. Phase 02 / Plan 02-01 — read the dashboard cook bar's pre-seed
    //      idea ONCE per cook invocation. Mirrors loadCookConfig's
    //      graceful-fail discipline: absent file, unreadable file, or
    //      whitespace-only contents all degrade to SEED_IDEA_SENTINEL. The
    //      value is captured into a single `seedIdea` local that every
    //      RunModeContext builder closes over. cook.md's Scope Step 2
    //      branches textually on the sentinel literal — TS does NOT decide
    //      whether to skip "What do you want to build?" (per 02-CONTEXT.md
    //      separation of concerns).
    const seedPath = resolvePath(io.cwd, '.swt-planning', '.pending-scope-idea.txt');
    let seedIdea: string = SEED_IDEA_SENTINEL;
    if (existsSyncFn(seedPath)) {
      try {
        const trimmed = readFileSyncFn(seedPath, 'utf8').trim();
        if (trimmed.length > 0) {
          seedIdea = trimmed;
          // Length-only log — never echo the user-typed text to avoid
          // accidentally surfacing in-flight ideas in logs / transcripts.
          io.stderr.write(`[cook] seed idea loaded (${seedIdea.length} chars)\n`);
        }
      } catch {
        // best-effort: any read failure falls back to the sentinel.
      }
    }

    // 3. Load config (auto_uat + QA gate overrides + orchestrator maxTurns).
    const config = loadCookConfig(io.cwd, {
      readFileSync: readFileSyncFn,
      existsSync: existsSyncFn,
    });

    // 4. Path 1 — flag detection.
    const fromFlags = detectModeFromFlags(parsed.flags);
    if (fromFlags !== undefined) {
      const fromFlagsOpts: ModeOptions = {
        ...fromFlags.opts,
        ...(phaseTarget !== undefined ? { phaseTarget } : {}),
      };
      const flagSessionId = resolveSessionId();
      // Path 1 — flag detection short-circuits the priority routing so the
      // priority_decision event records mode + priority=0 (flag-forced).
      emitCookEvent(io.cwd, flagSessionId, startTs, {
        type: 'cook.priority_decision',
        ts: new Date().toISOString(),
        session_id: flagSessionId,
        priority: 0,
        mode: fromFlags.mode,
      });
      // Plan 01-01 T2 — write CLI positional to seed file when the flag
      // forces Scope (e.g. `swt cook --scope "snake game"`).
      const flagWrittenSeed = maybeWriteSeedFromPositional({
        argsAfterTodo,
        phaseTarget,
        refHash,
        resolvedMode: fromFlags.mode,
        seedPath,
        existsSyncFn,
        readFileSyncFn,
        writeFileSyncFn,
        io,
      });
      return runMode(
        {
          mode: fromFlags.mode,
          priority: 0,
          requiresConfirmation: false,
        },
        fromFlagsOpts,
        io,
        config,
        {
          installRoot: resolveInstallRoot(),
          sessionId: flagSessionId,
          phaseDetectOutput: '',
          refHash,
          startTs,
          seedIdea: flagWrittenSeed ?? seedIdea,
        },
        { askUserFn, spawnFn, execSyncFn, readFileSyncFn, budgetGateFactory: budgetGateFactoryFn },
      );
    }

    // 5. Path 2 — natural-language intent (when args present).
    if (argsAfterTodo.length > 0 && phaseTarget === undefined) {
      const nlMode = detectModeFromNaturalLanguage(argsAfterTodo);
      if (nlMode !== undefined) {
        // NL routing ALWAYS confirms via askUser before executing
        // (TDD3 §7.2). The confirmation gate runs BEFORE we load
        // the cook.md mode section.
        const response = await askUserFn({
          question: `Interpreted as ${MODE_HEADING[nlMode]}. Proceed?`,
          options: [{ label: 'Yes', isRecommended: true }, { label: 'No' }],
        });
        if (!isAcceptResponse(response)) {
          return EXIT.SUCCESS;
        }
        const nlSessionId = resolveSessionId();
        emitCookEvent(io.cwd, nlSessionId, startTs, {
          type: 'cook.priority_decision',
          ts: new Date().toISOString(),
          session_id: nlSessionId,
          priority: 0,
          mode: nlMode,
        });
        // Plan 01-01 T2 — write CLI positional to seed file when NL
        // routing resolves to Scope. Today no NL keyword maps to scope,
        // so this guard short-circuits in current routing; the call is
        // symmetric for future-proofing against NL_KEYWORD_TABLE additions.
        const nlWrittenSeed = maybeWriteSeedFromPositional({
          argsAfterTodo,
          phaseTarget,
          refHash,
          resolvedMode: nlMode,
          seedPath,
          existsSyncFn,
          readFileSyncFn,
          writeFileSyncFn,
          io,
        });
        return runMode(
          {
            mode: nlMode,
            priority: 0,
            requiresConfirmation: false,
          },
          {
            skipQa: false,
            skipAudit: false,
            yolo: false,
          },
          io,
          config,
          {
            installRoot: resolveInstallRoot(),
            sessionId: nlSessionId,
            phaseDetectOutput: '',
            refHash,
            startTs,
            seedIdea: nlWrittenSeed ?? seedIdea,
          },
          {
            askUserFn,
            spawnFn,
            execSyncFn,
            readFileSyncFn,
            budgetGateFactory: budgetGateFactoryFn,
          },
        );
      }
    }

    // 6. Path 3 — state detection via detectPhase().
    const state = await detectPhaseFn({ cwd: io.cwd });
    const decision = routeFromPhaseDetect(state, config);

    // Priority 1 short-circuit — no Pi spawn.
    if ('kind' in decision && decision.kind === 'init-required') {
      io.stderr.write(`swt cook: Run 'swt init' first.\n`);
      return EXIT.SUCCESS;
    }
    let routing = decision as RoutingDecision;

    // TEST SEAM — Phase 5 plan 05-02. Pins the 11-priority router to a single
    // role for per-agent parity tests in test/regression/agent-parity/*.
    // Production users have no reason to set SWT_DEBUG_ONLY_ROLE; we gate
    // both on a strict role-union match AND on NODE_ENV=test (or
    // SWT_ALLOW_DEBUG_ROLE=1 for developer-local recording). The router still
    // runs first so the rest of the cook turn (events, runMode plumbing) sees
    // a real RoutingDecision shape — we only mutate `mode/priority` to force
    // single-role execution.
    const debugOnlyRole = process.env['SWT_DEBUG_ONLY_ROLE'];
    if (debugOnlyRole !== undefined && debugOnlyRole.length > 0) {
      if (process.env['NODE_ENV'] !== 'test' && process.env['SWT_ALLOW_DEBUG_ROLE'] !== '1') {
        throw new Error(
          'SWT_DEBUG_ONLY_ROLE is a test-only seam. Set NODE_ENV=test or SWT_ALLOW_DEBUG_ROLE=1 to use.',
        );
      }
      const pinned = ROLE_TO_ROUTING[debugOnlyRole as DebugOnlyRole];
      if (pinned === undefined) {
        throw new Error(
          `SWT_DEBUG_ONLY_ROLE=${debugOnlyRole} is not a known role. Valid: ${Object.keys(ROLE_TO_ROUTING).join(', ')}`,
        );
      }
      routing = {
        mode: pinned.mode,
        priority: pinned.priority,
        requiresConfirmation: false,
        ...(routing.phaseTarget !== undefined ? { phaseTarget: routing.phaseTarget } : {}),
      };
    }
    const stateSessionId = resolveSessionId();

    // Emit cook.priority_decision immediately after routing resolves. This
    // is the first of the 6 hook points in research §2.4. The event runs
    // BEFORE the confirmation gate so the dashboard can show "awaiting
    // confirmation" even when the user declines.
    emitCookEvent(io.cwd, stateSessionId, startTs, {
      type: 'cook.priority_decision',
      ts: new Date().toISOString(),
      session_id: stateSessionId,
      priority: routing.priority,
      mode: routing.mode,
      ...(routing.phaseTarget !== undefined ? { phase_target: routing.phaseTarget } : {}),
    });

    // Confirmation gate (priorities 2/3/3.5/4/6/8/9/10/11 when applicable).
    if (routing.requiresConfirmation && routing.confirmationQuestion !== undefined) {
      const response = await askUserFn({
        question: routing.confirmationQuestion,
        options: [{ label: 'Yes', isRecommended: true }, { label: 'No' }],
      });
      if (!isAcceptResponse(response)) {
        return EXIT.SUCCESS;
      }
    }

    // Priority 4 — prepare-reverification.sh inline before entering Verify.
    if (routing.priority === 4) {
      try {
        execSyncFn(
          `bash ${JSON.stringify(resolvePath(resolveInstallRoot(), 'scripts', 'prepare-reverification.sh'))} ${JSON.stringify(`.swt-planning/phases/${routing.phaseTarget ?? state.next_phase}`)}`,
          { cwd: io.cwd, encoding: 'utf8' },
        );
      } catch (err) {
        io.stderr.write(
          `swt cook: prepare-reverification.sh failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return EXIT.RUNTIME_ERROR;
      }
    }

    // Priority 7 — QA gate before entering Verify.
    if (routing.priority === 7) {
      const qaDecision = evaluateQaGate(state, config);
      if (qaDecision.kind === 'init_qa_remediation') {
        // Re-route the orchestrator into QA Remediation mode and skip
        // the verify spawn.
        return runMode(
          {
            mode: 'qa-remediation',
            priority: 7,
            requiresConfirmation: false,
            ...(routing.phaseTarget !== undefined ? { phaseTarget: routing.phaseTarget } : {}),
          },
          { skipQa: false, skipAudit: false, yolo: false },
          io,
          config,
          {
            installRoot: resolveInstallRoot(),
            sessionId: stateSessionId,
            phaseDetectOutput: '',
            refHash,
            startTs,
            seedIdea,
          },
          {
            askUserFn,
            spawnFn,
            execSyncFn,
            readFileSyncFn,
            budgetGateFactory: budgetGateFactoryFn,
          },
        );
      }
      if (qaDecision.kind === 'qa_rerun_required') {
        io.stderr.write(
          `swt cook: QA rerun required after ${qaDecision.attemptCount} attempts. Manual intervention.\n`,
        );
        return EXIT.RUNTIME_ERROR;
      }
      // run_qa_inline + proceed_to_uat both fall through to the verify
      // spawn — the inline QA run is the orchestrator's job inside the
      // verify mode body, not the TS handler's.
    }

    // Plan 01-01 T2 — write CLI positional to seed file when state-detected
    // routing resolves to Scope (the primary path the bug report targets:
    // greenfield `swt cook "snake game"` → priority 6 Scope).
    const stateWrittenSeed = maybeWriteSeedFromPositional({
      argsAfterTodo,
      phaseTarget,
      refHash,
      resolvedMode: routing.mode,
      seedPath,
      existsSyncFn,
      readFileSyncFn,
      writeFileSyncFn,
      io,
    });
    return runMode(
      routing,
      { skipQa: false, skipAudit: false, yolo: false },
      io,
      config,
      {
        installRoot: resolveInstallRoot(),
        sessionId: stateSessionId,
        phaseDetectOutput: stringifyPhaseDetect(state),
        refHash,
        startTs,
        seedIdea: stateWrittenSeed ?? seedIdea,
      },
      { askUserFn, spawnFn, execSyncFn, readFileSyncFn, budgetGateFactory: budgetGateFactoryFn },
    );
  };
}

interface RunModeContext {
  readonly installRoot: string;
  readonly sessionId: string;
  readonly phaseDetectOutput: string;
  readonly refHash: string | undefined;
  /** ISO timestamp captured when cookHandler starts — feeds the events
   *  JSONL filename so concurrent cook invocations don't collide. */
  readonly startTs: string;
  /**
   * Phase 02 / Plan 02-01 — Pre-seeded user idea from
   * `.swt-planning/.pending-scope-idea.txt` at handler entry, OR the
   * `(no idea provided yet)` sentinel when the file is absent or
   * unreadable. Substituted into cook.md's `${SEED_IDEA}` placeholder so
   * the Scope prompt can branch on whether the user typed something in
   * the dashboard cook bar.
   */
  readonly seedIdea: string;
}

interface RunModeDeps {
  readonly askUserFn: typeof defaultAskUser;
  readonly spawnFn: typeof spawnOrchestratorSession;
  readonly execSyncFn: typeof nodeExecSync;
  readonly readFileSyncFn: typeof readFileSync;
  /**
   * Plan 06-02 T4 — BudgetGate factory. Production wires
   * `defaultBudgetGateFactory`; tests inject a fake gate (or a factory
   * returning `null` to opt out of budget gating entirely).
   */
  readonly budgetGateFactory: BudgetGateFactory;
}

/**
 * Plan 04-01 T4 — Tunables for the cook-controls poller. Tests inject a
 * tight pollIntervalMs + maxPolls so they don't hang waiting for a
 * filesystem watcher; production keeps the 250ms default.
 */
export interface CookControlsConfig {
  readonly planningRoot?: string;
  readonly pollIntervalMs?: number;
  readonly maxPollsPerPause?: number;
  /** Disables polling entirely — primarily for the legacy cook.test.ts
   *  harness that has no signal-file fixture. Default: false (polling on). */
  readonly disabled?: boolean;
}

let cookControlsOverride: CookControlsConfig | undefined;
/**
 * Test seam — replaces the per-runMode cook-controls config. Production
 * callers never invoke; the cook-events integration test (plan 04-01 T5)
 * sets a tight poll interval so pause/cancel converge in milliseconds.
 */
export function __setCookControlsForTesting(config: CookControlsConfig | undefined): void {
  cookControlsOverride = config;
}

function resolveCookControls(io: CommandIO): CookControlsConfig {
  if (cookControlsOverride !== undefined) return cookControlsOverride;
  return { planningRoot: io.cwd };
}

/**
 * Poll the signal file at a runMode boundary. On 'pause', block on
 * waitForResumeOrCancel; on 'cancel' throw CookCancelledError; on
 * 'resume' (no pause was active) consume the signal and continue.
 */
async function checkBoundarySignal(sessionId: string, controls: CookControlsConfig): Promise<void> {
  if (controls.disabled === true) return;
  const sig = readPendingSignal(sessionId, controls.planningRoot);
  if (sig === null) return;
  if (sig === 'cancel') throw new CookCancelledError(sessionId);
  if (sig === 'pause') {
    const waitOpts: Parameters<typeof waitForResumeOrCancel>[1] = {};
    if (controls.pollIntervalMs !== undefined) {
      (waitOpts as { pollIntervalMs?: number }).pollIntervalMs = controls.pollIntervalMs;
    }
    if (controls.planningRoot !== undefined) {
      (waitOpts as { planningRoot?: string }).planningRoot = controls.planningRoot;
    }
    if (controls.maxPollsPerPause !== undefined) {
      (waitOpts as { maxPolls?: number }).maxPolls = controls.maxPollsPerPause;
    }
    const next = await waitForResumeOrCancel(sessionId, waitOpts);
    if (next === 'cancel') throw new CookCancelledError(sessionId);
  }
  // 'resume' with no active pause is a no-op — the signal is consumed.
}

/**
 * Plan 06-01 (Phase 6) T2 — derive a stable taskId for the per-spawn
 * task lifecycle events. One cook turn = one Pi orchestrator spawn = one
 * "task" from the resume probe's view (the cook.md mode body is what
 * actually executes the plan's tasks; the orchestrator is opaque from TS).
 * `${routing.mode}-${phaseTarget|'-'}` is the human-readable label that
 * the dashboard surfaces and the resume probe reads back.
 */
function deriveTaskId(routing: RoutingDecision): string {
  const target = routing.phaseTarget ?? '-';
  return `${routing.mode}-${target}`;
}

/**
 * Plan 06-01 T2 — best-effort current HEAD commit hash. Used to populate
 * `cook.task_commit.commit_hash` after a successful Pi spawn. Returns
 * undefined if `git log` fails (e.g. detached HEAD with no commits yet)
 * so emission falls back gracefully — the resume probe treats absence
 * the same as "task ran but no commit observed".
 */
export function tryReadHeadCommit(
  cwd: string,
  execSyncFn: typeof nodeExecSync,
): string | undefined {
  try {
    return execSyncFn('git log -1 --format=%H', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/**
 * Plan 06-03 T1 (R6) — count how many plan files live under the active
 * phase directory. Used to decide whether to emit the
 * `cook.worktree_isolation_warning` event at runMode start.
 *
 * Matches the canonical plan filename pattern
 * `NN-PP-PLAN.md` (e.g., `06-03-PLAN.md`) under
 * `.swt-planning/phases/<slug>/`. Returns 0 when the phase dir can't be
 * resolved or read — the warning is silently skipped (best-effort).
 *
 * `phaseTarget` here is the same value as `RoutingDecision.phaseTarget`
 * — usually the zero-padded phase number (`"06"`), but may carry the
 * slug suffix `"06-hardening"` when detectPhase surfaces a fuller label.
 */
export function countParallelPlans(cwd: string, phaseTarget: string | undefined): number {
  if (phaseTarget === undefined || phaseTarget.length === 0) return 0;
  const phasesRoot = resolvePath(cwd, '.swt-planning', 'phases');
  let phaseDir: string | undefined;
  try {
    const entries = readdirSync(phasesRoot, { withFileTypes: true });
    // Accept either an exact match (e.g., `"06"`) or a prefix match against
    // the phase-slug form (e.g., target=`"06"` matching dir `"06-hardening"`).
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === phaseTarget || entry.name.startsWith(`${phaseTarget}-`)) {
        phaseDir = resolvePath(phasesRoot, entry.name);
        break;
      }
    }
  } catch {
    return 0;
  }
  if (phaseDir === undefined) return 0;
  try {
    const files = readdirSync(phaseDir);
    return files.filter((f) => /^\d{2}-\d{2}-PLAN\.md$/.test(f)).length;
  } catch {
    return 0;
  }
}

/**
 * Plan 06-03 T2 — open WorktreeManager session for an orchestrator spawn.
 * Returned handle carries the per-task `WorktreeManager` plus the absolute
 * worktree path (used as `cwd` for the orchestrator + provider router).
 * Returns `null` (and logs a stderr warning) if worktree acquisition
 * fails — the cook turn falls back to the shared working tree rather
 * than blocking on filesystem / git contention.
 */
interface WorktreeSpawnSession {
  readonly manager: WorktreeManager;
  readonly taskId: string;
  /** Absolute path to the worktree on disk. */
  readonly absPath: string;
  /** Path relative to the project root — used in stderr breadcrumbs. */
  readonly relPath: string;
}

async function acquireWorktreeForSpawn(opts: {
  readonly cwd: string;
  readonly taskId: string;
  readonly stderr: NodeJS.WritableStream;
}): Promise<WorktreeSpawnSession | null> {
  try {
    const locksRoot = resolvePath(opts.cwd, '.swt-planning', 'locks');
    const lockOps = createLockOpsFromAcquireLock((a) => acquireLock(a), locksRoot);
    const manager = new WorktreeManager({
      parallelRoot: resolvePath(opts.cwd, '.swt-planning', 'parallel'),
      journalRoot: resolvePath(opts.cwd, '.swt-planning', 'journal'),
      lockOps,
    });
    // The base ref is HEAD — we want to start the worktree at the same
    // commit the cook invocation was kicked off at. `WorktreeManager.create`
    // shells out to `git worktree add` which resolves HEAD itself if we
    // pass 'HEAD' as the ref.
    const { worktreePath } = await manager.create(opts.taskId, 'HEAD');
    const absPath = resolvePath(opts.cwd, worktreePath);
    return { manager, taskId: opts.taskId, absPath, relPath: worktreePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.stderr.write(
      `swt cook: [worktree-isolation] WARNING: worktree acquisition failed (${msg}); ` +
        `falling back to shared working tree. Set worktree_isolation: 'off' to silence.\n`,
    );
    return null;
  }
}

/**
 * Plan 06-03 T2 — drive a happy-path worktree through the FSM tail end
 * (claimed → dispatched → agent_running → agent_complete → harvested →
 * removed). The intermediate transitions are required by the
 * `WorktreeManager` FSM but carry no extra state in cook's single-
 * orchestrator-spawn shape today (orchestrator's per-teammate worktrees
 * are managed via the bash scripts that ship with VBW per research §2.3).
 */
async function releaseWorktreeOnSuccess(
  session: WorktreeSpawnSession,
  stderr: NodeJS.WritableStream,
): Promise<void> {
  try {
    await session.manager.claim(session.taskId, []);
    await session.manager.dispatch(session.taskId);
    await session.manager.markAgentRunning(session.taskId);
    await session.manager.markAgentComplete(session.taskId, 'success');
    await session.manager.harvest(session.taskId);
    await session.manager.remove(session.taskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(
      `swt cook: [worktree-isolation] WARNING: worktree cleanup failed for ${session.relPath} ` +
        `(${msg}); kept in place. Run \`swt cleanup\` to reap.\n`,
    );
  }
}

/**
 * Plan 06-03 T2 — drive the worktree FSM through to `fail` so the lock
 * envelope reflects the failed state. The worktree directory itself is
 * preserved on disk per TDD2 §9.7 ("failed: Keep (forensics)") — the
 * operator decides whether to drop it via `swt cleanup`.
 */
async function keepWorktreeForForensics(
  session: WorktreeSpawnSession,
  reason: string,
  stderr: NodeJS.WritableStream,
): Promise<void> {
  try {
    await session.manager.fail(session.taskId, reason);
    stderr.write(
      `swt cook: [worktree-isolation] worktree kept at ${session.relPath} for forensics (${reason}).\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(
      `swt cook: [worktree-isolation] WARNING: failed to transition worktree to failed state ` +
        `for ${session.relPath} (${msg}); the lock file may be stale.\n`,
    );
  }
}

/**
 * Plan 06-01 T2 — write a fresh in_progress execution-state for this
 * runMode invocation. Best-effort: a filesystem error here must NOT
 * break the cook turn (the resume probe will simply not detect the
 * crash and the next invocation will start fresh).
 */
function recordRunModeStart(io: CommandIO, ctx: RunModeContext, routing: RoutingDecision): void {
  try {
    const phaseTarget = routing.phaseTarget;
    const planEntry =
      phaseTarget !== undefined ? [{ plan: phaseTarget, status: 'in_progress' as const }] : [];
    const state: ExecutionStateRecord = {
      phase: phaseTarget !== undefined ? Number.parseInt(phaseTarget, 10) || 0 : 0,
      phase_name: routing.mode,
      status: 'in_progress',
      wave: 0,
      total_waves: 0,
      plans: planEntry,
      correlation_id: ctx.sessionId,
      session_id: ctx.sessionId,
      pid: process.pid,
      started_at: ctx.startTs,
      last_event_ts: new Date().toISOString(),
    };
    writeExecutionState(io.cwd, state);
  } catch {
    // best-effort — see comment above.
  }
}

/**
 * Plan 06-02 T4 — classify a thrown error from `spawnOrchestratorSession`
 * into a `FallbackFailureReason`. Recognizes Pi 0.74's `auto_retry_503` /
 * `auto_retry_429` / `auto_retry_500` markers (see `provider-fallback.ts`
 * head comment) and HTTP status codes embedded in error messages. Returns
 * `'other'` for anything we don't recognize, which the cook callsite
 * treats as NON-retryable (no fallback hop consumed; the error re-throws
 * immediately).
 */
export function classifyError(err: unknown): FallbackFailureReason {
  const message = err instanceof Error ? err.message : String(err);
  if (/auto_retry_503\b|\b503\b/.test(message)) return '503';
  if (/auto_retry_429\b|\b429\b/.test(message)) return '429';
  if (/auto_retry_500\b|\b500\b/.test(message)) return '500';
  return 'other';
}

/**
 * Phase 2 / G-R3 (plan 02-03) — compound tier vocabulary for
 * `tier-routed-compound`. Source of truth:
 * `packages/orchestration/src/provider-router.ts:CompoundTier`. Order matches
 * the `CompoundTierSchema` Zod enum entry order (load-bearing for the doc
 * table at `docs/operations/provider-routing.md`).
 */
const validCompoundTiers = [
  'cheap-fast',
  'cheap-standard',
  'standard-fast',
  'standard-standard',
  'standard-slow',
  'premium-standard',
  'premium-slow',
  'reasoning',
  'balanced',
  'quality',
] as const;
type ValidCompoundTier = (typeof validCompoundTiers)[number];

function isValidCompoundTier(s: string): s is ValidCompoundTier {
  return (validCompoundTiers as readonly string[]).includes(s);
}

/**
 * Plan 06-02 T4 — map `CookProviderStrategy` (config-shape) to
 * `RouterStrategy` (orchestration-shape). The only meaningful difference
 * is the `tier-routed` map key type — config accepts `Record<string,...>`
 * while the router uses `Partial<Record<Tier,...>>`. Filtering down to
 * known tier names keeps the router contract clean.
 *
 * Phase 2 / G-R3 (plan 02-03) extends with `'tier-routed-compound'`:
 *   - Map keys are filtered against `validCompoundTiers` (10 strings).
 *   - `fallbackStrategy` is mapped recursively at the config layer.
 *   - The router-layer Exclude<...> bound on
 *     `RouterStrategy.tier-routed-compound.fallbackStrategy` catches
 *     nested `tier-routed-compound` configs at TS-narrowing time; an
 *     `as` cast widens the recursive result to the router union here
 *     (a localized escape valve — see inline comment).
 */
export function toRouterStrategy(strategy: CookProviderStrategy): RouterStrategy {
  switch (strategy.kind) {
    case 'pinned':
      return { kind: 'pinned', provider: strategy.provider };
    case 'round-robin':
      return { kind: 'round-robin', providers: strategy.providers };
    case 'tier-routed': {
      const validTiers: ReadonlyArray<RouterTier> = [
        'cheap-fast',
        'balanced',
        'quality',
        'reasoning',
      ];
      const map: Partial<Record<RouterTier, string>> = {};
      for (const tier of validTiers) {
        const v = strategy.map[tier];
        if (typeof v === 'string') map[tier] = v;
      }
      return { kind: 'tier-routed', map, fallback: strategy.fallback };
    }
    case 'cost-optimized':
      return {
        kind: 'cost-optimized',
        providers: strategy.providers,
        priceTable: strategy.priceTable,
      };
    case 'cost-optimized-rate-card': {
      // Verbatim pass-through — the cook config shape and the router
      // shape are intentionally identical for this kind. `model` is
      // conditionally spread so an omitted-input remains omitted-output
      // (preserves exactOptionalPropertyTypes if/when enabled).
      return {
        kind: 'cost-optimized-rate-card',
        providers: strategy.providers,
        rateCard: strategy.rateCard,
        dimension: strategy.dimension,
        ...(strategy.model !== undefined ? { model: strategy.model } : {}),
      };
    }
    case 'tier-routed-compound': {
      // Phase 2 / G-R3 R2 — filter stringly-typed config keys against the
      // 10 known CompoundTier values. Unknown keys are dropped silently to
      // mirror the legacy `'tier-routed'` filter behaviour above (an
      // operator with a typo gets a quiet drop, not a hard failure).
      const mapped: Partial<Record<CompoundTier, string>> = {};
      for (const [k, v] of Object.entries(strategy.map)) {
        if (typeof v === 'string' && isValidCompoundTier(k)) {
          mapped[k] = v;
        }
      }
      // R3 bounded depth-1 recursion. The cook config layer accepts open
      // recursion (`fallbackStrategy?: CookProviderStrategy`) so config
      // files can express any nesting. The router-layer type bound
      // (`Exclude<RouterStrategy, {kind:'tier-routed-compound'}>`) rejects
      // nested `tier-routed-compound`. The `as never` widens here: if an
      // operator nests a tier-routed-compound under another, the mapped
      // RouterStrategy would still be runtime-correct (the inner case is
      // implemented the same way), but the TYPE bound documents the
      // depth-1 INTENT. Do not refactor without understanding R3.
      const recursiveFallback =
        strategy.fallbackStrategy !== undefined
          ? toRouterStrategy(strategy.fallbackStrategy)
          : undefined;
      type CompoundFallback = Exclude<RouterStrategy, { readonly kind: 'tier-routed-compound' }>;
      return {
        kind: 'tier-routed-compound',
        map: mapped,
        fallback: strategy.fallback,
        ...(recursiveFallback !== undefined
          ? { fallbackStrategy: recursiveFallback as CompoundFallback }
          : {}),
      };
    }
  }
}

/**
 * Plan 01-01 (Milestone 12) — `resolveSpawnCredential` moved to
 * `@swt-labs/runtime` (L2) so the dashboard L7 chat route (plan 01-03) can
 * consume it without violating the layer rules.
 *
 * The function definition (~64 LOC), its JSDoc, and its full behaviour
 * contract (api_key happy path, OAuth refresh + stale-blob degrade, every
 * graceful-undefined branch) now live in
 * `packages/runtime/src/credentials/resolve-spawn-credential.ts`. This
 * re-export keeps backward compatibility for the cli test files that import
 * `{ resolveSpawnCredential } from '../../src/commands/cook.js'`
 * (cook-auth-wiring.test.ts, cook-oauth-refresh.test.ts, cook-oauth-e2e.test.ts)
 * and for `init.ts` which imports it via this module.
 *
 * Originally Plan 02-04 (Phase 2 / Selection → Spawn Wiring) + Plan 04-04
 * (Phase 4 / Risk 2 — SWT-owns-refresh).
 */
export { resolveSpawnCredential };

/**
 * Plan 06-02 T3 (REQ-15) — provider router + fallback chain wired into
 * the cook spawn callsite. Constructs a per-spawn `ProviderRouter` +
 * `FallbackChain` from `config.providers`, picks the primary, then loops
 * `deps.spawnFn` until success OR chain exhaustion. On each failure:
 *
 *   1. `classifyError` maps the thrown error to a `FallbackFailureReason`
 *      (recognized HTTP/Pi markers → '503'|'429'|'500'; else 'other').
 *   2. `'other'` short-circuits the chain — the error re-throws to the
 *      existing outer error path without consuming a fallback hop.
 *   3. Recognised retryable reasons advance the chain. The chain's own
 *      `publish` hook emits `provider.fallback_fired` for each transition
 *      (forwarded to the test seam `providerEventSinkFn` when wired).
 *   4. `FallbackChainExhaustedError` (either `'request_count'` or
 *      `'time_budget'`) re-throws as-is; the outer try/catch in `runMode`
 *      surfaces it on the cook events JSONL via `cook.error`.
 *
 * The function returns the provider id that ultimately succeeded so the
 * caller can record cost-attribution into the existing TPAC pipeline once
 * Phase 5 token plumbing lands.
 *
 * Returns: `{result, providerUsed, attempts}` on success.
 *
 * Throws: the underlying spawn error (`'other'` classification) OR
 * `FallbackChainExhaustedError` when the chain runs out of options.
 */
export interface RunSpawnWithFallbackResult {
  readonly result: Awaited<ReturnType<typeof spawnOrchestratorSession>>;
  readonly providerUsed: string;
  readonly attempts: number;
}

/**
 * Plan 03-04 (Phase 3 / G-R4) — typed pre-spawn budget halt.
 *
 * Thrown from inside `runSpawnWithFallback` when the `onProjection` handler
 * returns a `BudgetProjectionResult` with `would_exceed: true` — aborting the
 * spawn BEFORE `spawnFn` is ever invoked (no money spent). The cook callsite's
 * existing `try { ... } catch` around the `runSpawnWithFallback` invocation
 * catches it via `instanceof` and turns it into a `cook.task_fail` +
 * `cook.completion(failed)` + `EXIT.RUNTIME_ERROR`, mirroring the
 * `paused_on_entry` failure shape.
 *
 * Carries the projection + the gate's projection result on the instance so the
 * catch branch (and tests) can inspect the forecast that triggered the halt.
 */
export class BudgetProjectionExceededError extends Error {
  readonly projection: CostProjection;
  readonly projectionResult: BudgetProjectionResult;

  constructor(projectionResult: BudgetProjectionResult) {
    const pressurePct = (projectionResult.projected_pressure * 100).toFixed(1);
    super(
      `pre-spawn cost projection would exceed the budget ` +
        `(projected pressure ${pressurePct}%, ` +
        `projected_cost_usd=$${projectionResult.projection.projected_cost_usd.toFixed(4)})`,
    );
    this.name = 'BudgetProjectionExceededError';
    this.projection = projectionResult.projection;
    this.projectionResult = projectionResult;
  }
}

export interface RunSpawnWithFallbackOptions {
  readonly providers: CookProvidersConfig;
  readonly spawnArgs: Parameters<typeof spawnOrchestratorSession>[0];
  readonly spawnFn: typeof spawnOrchestratorSession;
  readonly taskBrief: TaskBrief;
  readonly tier?: RouterTier;
  /**
   * Optional sink for `provider.fallback_fired` events. Production wires
   * this to a stderr-or-journal emitter; tests inject a capture array.
   */
  readonly onProviderEvent?: (event: ProviderFallbackEvent) => void;
  /**
   * Plan 02-04 (Phase 2 / G-R3) — fired once per spawn AFTER the router
   * resolves the primary provider. The cook callsite wires this to
   * `emitCookEvent('cook.provider_selected', ...)`. Optional — omitted
   * callers see no behavioural change. `rate_card_age_ms` is computed here
   * (in `runSpawnWithFallback`) from the strategy's embedded rate-card
   * timestamps since the orchestration layer has no clock.
   */
  readonly onSelectionEvent?: (ev: {
    selected_provider: string;
    selected_via: SelectedVia;
    tier?: string;
    rate_card_age_ms?: number;
    rate_card_source?: 'embedded' | 'project-override' | 'fetched';
    dimension?: 'input' | 'output' | 'blended';
    sub_session_id: string;
  }) => void;
  /**
   * Plan 03-04 (Phase 3 / G-R4) — fired once per spawn AFTER the router
   * resolves the primary provider, BEFORE the fallback chain runs. The cook
   * callsite wires this to projectSpawnCost(...) -> gate.project(...) ->
   * emit cook.budget_projected. When the handler returns a result with
   * would_exceed: true, runSpawnWithFallback throws BudgetProjectionExceededError
   * and the spawn is aborted pre-emptively (no spawnFn call). Optional —
   * omitted callers see no behavioural change.
   */
  readonly onProjection?: (ctx: {
    provider: string;
    sub_session_id: string;
  }) => BudgetProjectionResult | undefined;
  /**
   * Plan 02-04 — the sub-session id correlated with this spawn. Threaded
   * through so `onSelectionEvent` can stamp `cook.provider_selected` with
   * the same `sub_session_id` the sibling cook events carry. Optional for
   * backwards compat; when absent, `onSelectionEvent` receives an empty
   * string (callers not wiring telemetry don't supply it).
   */
  readonly subSessionId?: string;
  /**
   * Plan 02-04 (Phase 2 / Selection → Spawn Wiring) — invoked per-attempt
   * with the provider the chain selected (`selection.provider`), BEFORE
   * `spawnFn` runs. Returns the keychain-resolved credential to merge into
   * `spawnArgs`, or `undefined` to spawn with no `resolvedCredential`
   * (byte-identical to pre-Phase-2). Re-invoked on a fallback hop so a hop
   * to a DIFFERENT provider resolves THAT provider's credential. Optional —
   * omitted callers (every pre-Phase-2 callsite, every test not exercising
   * the credential path) see no behavioural change.
   */
  readonly onResolveCredential?: (
    provider: string,
  ) => Promise<
    { provider: string; resolvedCredential: { authMode: AuthMode; secret: string } } | undefined
  >;
  /** Test seam — override the per-chain clock for deterministic time-budget assertions. */
  readonly clock?: () => number;
  /** Test seam — override classifyError so tests can inject reason classifications. */
  readonly classifyErrorFn?: (err: unknown) => FallbackFailureReason;
}

export async function runSpawnWithFallback(
  opts: RunSpawnWithFallbackOptions,
): Promise<RunSpawnWithFallbackResult> {
  const classify = opts.classifyErrorFn ?? classifyError;
  const tier: RouterTier = opts.tier ?? 'balanced';
  const router = createProviderRouter(toRouterStrategy(opts.providers.strategy));
  // Plan 02-04 (Phase 2 / G-R3) — prefer `selectWithMetadata` for telemetry-
  // rich emission; fall back to `select(ctx)` for any external router
  // implementor that doesn't expose the optional metadata method (backwards
  // compat). EITHER is called once per spawn, never both.
  const selectionCtx = { task: opts.taskBrief, tier };
  const selectionMeta = router.selectWithMetadata?.(selectionCtx);
  const primary = selectionMeta?.provider ?? router.select(selectionCtx);

  // Compute `rate_card_age_ms` ONLY for the rate-card strategy variant. The
  // orchestration layer has no clock, so the cook code re-derives the age
  // from the strategy's embedded `rateCard.entries[*].updated_at` timestamps
  // directly (oldest entry age = now - min(updated_at)). No extra loader call.
  let rateCardAgeMs: number | undefined;
  if (
    selectionMeta?.rate_card_source !== undefined &&
    opts.providers.strategy.kind === 'cost-optimized-rate-card'
  ) {
    const entries = opts.providers.strategy.rateCard.entries;
    if (entries.length > 0) {
      const oldest = Math.min(...entries.map((e) => Date.parse(e.updated_at)));
      if (!Number.isNaN(oldest)) {
        rateCardAgeMs = Math.max(0, Date.now() - oldest);
      }
    }
  }

  if (selectionMeta !== undefined && opts.onSelectionEvent !== undefined) {
    opts.onSelectionEvent({
      selected_provider: selectionMeta.provider,
      selected_via: selectionMeta.selected_via,
      tier: selectionMeta.tier,
      rate_card_age_ms: rateCardAgeMs,
      rate_card_source: selectionMeta.rate_card_source,
      dimension: selectionMeta.dimension,
      sub_session_id: opts.subSessionId ?? '',
    });
  }

  // Plan 03-04 (Phase 3 / G-R4) — pre-spawn cost projection. The router has
  // resolved `primary`; that's the single input the projection needs. The
  // cook callsite's handler does projectSpawnCost -> gate.project -> emit;
  // we only own the abort: when the handler signals would_exceed, throw a
  // typed error that the runMode try/catch turns into a pre-spawn halt.
  // Invoked at most once per runSpawnWithFallback call; when opts.onProjection
  // is undefined this is a no-op and behaviour is byte-identical to Phase 2.
  const projectionResult = opts.onProjection?.({
    provider: primary,
    sub_session_id: opts.subSessionId ?? '',
  });
  if (projectionResult?.would_exceed === true) {
    throw new BudgetProjectionExceededError(projectionResult);
  }

  // The chain's `primary` is what the router picked; fallbacks come straight
  // from config. The empty-fallbacks list yields a degenerate chain (one
  // provider, one attempt) — preserves today's single-provider behavior
  // when the user hasn't opted into multi-provider routing.
  const chainOpts: Parameters<typeof createFallbackChain>[0] = {
    primary,
    fallbacks: opts.providers.fallbacks,
    retryBudget: opts.providers.retryBudget,
    timeBudgetMs: opts.providers.timeBudgetMs,
    ...(opts.onProviderEvent !== undefined ? { publish: opts.onProviderEvent } : {}),
    ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
  };
  const chain = createFallbackChain(chainOpts);

  // Loop guard: the chain's `select` throws on exhaustion, so the loop
  // terminates either via successful spawn (break) or thrown error
  // (FallbackChainExhaustedError or `'other'`-classified re-throw).

  while (true) {
    const selection = chain.select(opts.taskBrief);
    try {
      // Phase G / Phase 1 / G-R1 R2 — thread the router-resolved
      // primary provider (or the fallback chain's next provider on a
      // retry hop) into spawnArgs so spawnOrchestratorSession's
      // `readProviderOverlay()` keys off the right provider id on
      // every attempt. R2 ("caller resolves") is realised here: the
      // router lives at this callsite and the spawn path consumes a
      // string. When no overlay file exists for the resolved provider,
      // the spawn is byte-identical to pre-Phase-1 (R4 vendor-
      // neutrality preserved by construction).
      //
      // Plan 02-04 (Phase 2 / Selection → Spawn Wiring) — resolve the
      // keychain credential for THIS attempt's provider via the optional
      // `onResolveCredential` callback (re-invoked per attempt so a
      // fallback hop to a different provider resolves that provider's
      // credential). When the callback is omitted, or returns `undefined`
      // (no `auth` entry / keychain miss — graceful degrade), no
      // `resolvedCredential` is merged and the spawn is byte-identical to
      // pre-Phase-2.
      const resolved = opts.onResolveCredential
        ? await opts.onResolveCredential(selection.provider)
        : undefined;
      const spawnArgsWithProvider = {
        ...opts.spawnArgs,
        provider: selection.provider,
        ...(resolved !== undefined ? { resolvedCredential: resolved.resolvedCredential } : {}),
      };
      const result = await opts.spawnFn(spawnArgsWithProvider);
      return {
        result,
        providerUsed: selection.provider,
        attempts: selection.attempt,
      };
    } catch (err) {
      if (err instanceof FallbackChainExhaustedError) throw err;
      const reason = classify(err);
      if (reason === 'other') {
        // Non-retryable — don't consume a fallback hop; re-throw to outer.
        throw err;
      }
      // recordFailure may throw FallbackChainExhaustedError if budget /
      // time runs out as a side-effect; let it propagate.
      const hasNext = chain.recordFailure(selection.provider, reason, opts.taskBrief);
      if (!hasNext) {
        // No further providers — synthesize the exhaustion error so the
        // caller sees a uniform throw shape. recordFailure already emits
        // no event when there's no next provider (publish is conditional
        // on hasNext); this throw is the chain's terminal signal.
        throw new FallbackChainExhaustedError(
          opts.taskBrief.taskId,
          chain.attemptsTaken(),
          opts.providers.retryBudget,
          'request_count',
        );
      }
      // hasNext === true → loop continues; chain.select() returns the next provider.
    }
  }
}

async function runMode(
  routing: RoutingDecision,
  opts: ModeOptions,
  io: CommandIO,
  config: CookConfig,
  ctx: RunModeContext,
  deps: RunModeDeps,
): Promise<ExitCode> {
  // Plan 04-01 T4 — mode-dispatch boundary signal check (R2 next-boundary
  // pause + SIGTERM cancel). The poll is one stat() — negligible against
  // Pi turn latency.
  const controls = resolveCookControls(io);
  try {
    await checkBoundarySignal(ctx.sessionId, controls);
  } catch (err) {
    if (err instanceof CookCancelledError) {
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.completion',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        status: 'cancelled',
      });
      io.stderr.write(`swt cook: cancelled by user (session ${ctx.sessionId}).\n`);
      return EXIT.USER_CANCELLED;
    }
    throw err;
  }

  // Plan 06-01 (Phase 6) T2 — write fresh in_progress execution-state and
  // emit cook.task_start before the orchestrator spawn. The outer try/finally
  // flips status to crashed on uncaught errors so the next cookHandler
  // invocation's resume probe can detect the crash.
  recordRunModeStart(io, ctx, routing);
  const taskId = deriveTaskId(routing);
  const planLabel = routing.phaseTarget ?? routing.mode;
  emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
    type: 'cook.task_start',
    ts: new Date().toISOString(),
    session_id: ctx.sessionId,
    plan: planLabel,
    task_id: taskId,
  });

  // Plan 06-03 T1 (R6) — one-time warning when `worktree_isolation: 'off'`
  // AND the active phase carries 2+ parallel plans. v3.0 keeps the default
  // `'off'` to avoid unknown downstream-caller risk; the warning gives
  // operators a clear opt-in signal. The Phase 4 Wave 2 commits
  // 7431a02 / 05ebd94 had misleading commit subjects because parallel
  // teammates `git add`'d each other's files — flipping isolation to `'on'`
  // ringfences each teammate to its own worktree index.
  if (config.worktree_isolation === 'off') {
    const parallelPlanCount = countParallelPlans(io.cwd, routing.phaseTarget);
    if (parallelPlanCount >= 2) {
      io.stderr.write(
        `swt cook: [worktree-isolation] WARNING: this phase has ${parallelPlanCount} parallel plans ` +
          `but worktree_isolation is 'off' — git staging-area race possible ` +
          `(see docs/operations/worktree-isolation.md). Recommend setting ` +
          `worktree_isolation: 'on' in .swt-planning/config.json.\n`,
      );
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.worktree_isolation_warning',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        parallel_plans: parallelPlanCount,
      });
    }
  }

  // Plan 06-02 T4 (REQ-16) — BudgetGate task-loop integration. Construct
  // the gate before the spawn so:
  //   1. We can refuse to spawn when the milestone is already paused
  //      (gate state === 'paused' on entry → emit cook.budget_exceeded
  //      and exit with EXIT.RUNTIME_ERROR).
  //   2. We subscribe to gate transitions so a daughter session that
  //      blows through the pause threshold mid-spawn surfaces a
  //      cook.budget_exceeded event on the JSONL channel.
  //   3. `budget.resume` (after a manual ceiling bump from the dashboard)
  //      surfaces as `cook.budget_resume` so the dashboard's reducer can
  //      flip the milestone state back to running.
  //
  // The gate is per-runMode; the chokidar adapter starts watching the
  // metrics dir on construction and stops on dispose. Both are best-effort
  // — a filesystem error never blocks a cook turn (the factory returns
  // null in that case and budget gating is silently skipped).
  const budgetGateHandle = deps.budgetGateFactory({
    config: config.budget,
    cwd: io.cwd,
  });
  const gate: BudgetGate | undefined = budgetGateHandle?.gate;
  let gateUnsubscribe: (() => void) | undefined;
  if (gate !== undefined) {
    // Pre-spawn evaluation — paused milestone refuses new spawns.
    const stateOnEntry = gate.state();
    if (stateOnEntry.status === 'paused') {
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.budget_exceeded',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        reason: 'paused_on_entry',
        spent_usd: stateOnEntry.spent_usd,
        ceiling_usd: stateOnEntry.ceiling_usd,
        threshold: config.budget.pause_threshold,
      });
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.task_fail',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        plan: planLabel,
        task_id: taskId,
        reason: 'budget_paused_on_entry',
      });
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.completion',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        status: 'failed',
      });
      io.stderr.write(
        `swt cook: milestone budget is paused ` +
          `(spent=$${stateOnEntry.spent_usd.toFixed(2)} of $${stateOnEntry.ceiling_usd.toFixed(2)}). ` +
          `Raise the ceiling via the dashboard /api/budget/bump endpoint, then retry.\n`,
      );
      try {
        markCrashed(io.cwd);
      } catch {
        // best-effort
      }
      if (budgetGateHandle?.dispose !== undefined) {
        try {
          await budgetGateHandle.dispose();
        } catch {
          // best-effort
        }
      }
      return EXIT.RUNTIME_ERROR;
    }
    // Subscribe for in-flight transitions. Daughter sessions writing to
    // .metrics/ during the spawn may cross the pause threshold; we surface
    // that on the JSONL channel so the dashboard can react.
    gateUnsubscribe = gate.subscribe((ev) => {
      if (ev.type === 'budget.pause') {
        emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
          type: 'cook.budget_exceeded',
          ts: ev.ts,
          session_id: ctx.sessionId,
          reason: 'paused_during_spawn',
          spent_usd: ev.spent_usd,
          ceiling_usd: ev.ceiling_usd,
          threshold: ev.threshold,
        });
      } else if (ev.type === 'budget.resume') {
        emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
          type: 'cook.budget_resume',
          ts: ev.ts,
          session_id: ctx.sessionId,
          spent_usd: ev.spent_usd,
          ceiling_usd: ev.ceiling_usd,
        });
      }
      // budget.warning is a notice-only event today; the dashboard renders
      // it from the SSE feed plumbed by plan 06-02 T5. No JSONL row needed.
    });
  }

  // Plan 06-03 T2 (R6) — when worktree_isolation is enabled, acquire a
  // dedicated git worktree for the orchestrator session before the spawn.
  // The orchestrator runs in its own working tree (`.swt-planning/parallel/
  // wt-<taskId>/`) with its own staging-area index, eliminating the Phase 4
  // Wave 2 race (commits 7431a02 / 05ebd94). The worktree is harvested +
  // removed on success; failed runs keep the worktree for forensics per
  // TDD2 §9.7.
  //
  // Best-effort: a worktree creation failure surfaces as a stderr warning
  // and falls back to the shared working tree. The cook turn must not be
  // blocked on filesystem / git contention — operators flipping the flag
  // explicitly accept the experimental wiring (R6 — default 'off').
  const isolationEnabled =
    config.worktree_isolation === 'on' ||
    (config.worktree_isolation === 'auto' && countParallelPlans(io.cwd, routing.phaseTarget) >= 2);
  let worktreeSession: WorktreeSpawnSession | null = null;
  if (isolationEnabled) {
    worktreeSession = await acquireWorktreeForSpawn({
      cwd: io.cwd,
      taskId,
      stderr: io.stderr,
    });
  }
  const spawnCwd = worktreeSession?.absPath ?? io.cwd;

  // Load the cook.md mode section + substitute placeholders.
  const prompt = loadCookModeSection(
    ctx.installRoot,
    routing.mode,
    ctx.phaseDetectOutput,
    ctx.seedIdea,
    { readFileSync: deps.readFileSyncFn },
  );

  const promptWithOpts = appendModeOptions(prompt, opts, routing, ctx.refHash);

  const maxTurns = config.agent_max_turns_orchestrator ?? 100;
  // The sub-session-id is the orchestrator session id — we don't have a
  // separate Pi sub-session here (the orchestrator IS the spawned Pi
  // session). Plan 04-01 T5's hook script publishes per-tool events under
  // the orchestrator's session id, which doubles as the sub-session id for
  // the dashboard's active-agent pane.
  const subSessionId = ctx.sessionId;

  emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
    type: 'cook.agent_spawn',
    ts: new Date().toISOString(),
    session_id: ctx.sessionId,
    role: 'orchestrator',
    sub_session_id: subSessionId,
  });

  // Plan 03-04 (Phase 3 / G-R4) — best-effort rate-card load for the
  // pre-spawn cost projection. A missing/malformed project rate card NEVER
  // blocks a cook turn (same posture as defaultBudgetGateFactory returning
  // null — research §6.2 best-effort discipline).
  let rateCard: RateCard | undefined;
  try {
    rateCard = createRateCardSource({ cwd: io.cwd }).readCurrent();
  } catch {
    rateCard = undefined;
  }
  // Projection is wired ONLY when ALL of: (a) projection_enabled !== false
  // (an explicit `false` opts out); (b) the best-effort rate-card load
  // succeeded; (c) a budget gate exists for this runMode invocation (the
  // same `gate` handle the paused_on_entry block consulted — when
  // defaultBudgetGateFactory returned null there is no gate and projection
  // is skipped). When any condition fails, onProjection is left UNDEFINED
  // and runSpawnWithFallback runs exactly as in Phase 2 (graceful degrade —
  // the file-meter backstop stays the safety net). Decision computed once.
  const projectionGate = gate;
  const projectionActive =
    config.budget.projection_enabled !== false &&
    rateCard !== undefined &&
    projectionGate !== undefined;

  try {
    // Plan 06-02 T3 (REQ-15) — provider router + fallback chain. The
    // chain is per-spawn; an empty fallback list (the default) yields a
    // degenerate one-attempt chain that preserves today's single-provider
    // behavior. Multi-provider deployments opt in via `.swt-planning/
    // config.json#providers`.
    const fallbackTaskBrief: TaskBrief = {
      taskId: taskId,
      role: 'orchestrator',
      cwd: spawnCwd,
    };
    const fallbackResult = await runSpawnWithFallback({
      providers: config.providers,
      spawnArgs: {
        prompt: promptWithOpts,
        cwd: spawnCwd,
        sessionId: ctx.sessionId,
        installRoot: ctx.installRoot,
        maxTurns,
      },
      spawnFn: deps.spawnFn,
      taskBrief: fallbackTaskBrief,
      // Plan 02-04 (Phase 2 / G-R3) — thread the sub-session id so the
      // telemetry events below carry the same correlation id as the sibling
      // cook.* emissions.
      subSessionId,
      // Plan 02-04 (Phase 2 / Selection → Spawn Wiring) — resolve the
      // OS-keychain credential for whichever provider the chain selects, at
      // spawn time. `config.auth` is the `auth` block parsed by
      // `loadCookConfig`; when it is empty (`DEFAULT_AUTH_CONFIG` — no `auth`
      // block configured) `resolveSpawnCredential` returns `undefined` for
      // every provider, so `runSpawnWithFallback` merges no `resolvedCredential`
      // and the spawn is byte-identical to pre-Phase-2. The resolved secret
      // rides straight into `spawnArgs` → `spawnOrchestratorSession` →
      // `createSession`'s in-memory `AuthStorage` injection — never logged,
      // never persisted.
      onResolveCredential: (provider) => resolveSpawnCredential(provider, config.auth),
      // Plan 02-04 (Phase 2 / G-R3) — emit cook.provider_selected onto the
      // JSONL channel once per spawn after the router resolves the primary.
      // Statusline-extension milestone — also carry the resolved model id
      // when the cook callsite knows it. Today the only callsite-resolvable
      // model source is `strategy.model` on `cost-optimized-rate-card`
      // strategies; for `pinned` / `tier-routed` / `round-robin` Pi's
      // ModelRegistry resolves the provider default internally so the
      // cook callsite doesn't see the id, and the dashboard statusline
      // falls back to `—`.
      onSelectionEvent: (ev) => {
        const resolvedModel =
          config.providers.strategy.kind === 'cost-optimized-rate-card'
            ? config.providers.strategy.model
            : undefined;
        emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
          type: 'cook.provider_selected',
          ts: new Date().toISOString(),
          session_id: ctx.sessionId,
          sub_session_id: ev.sub_session_id,
          selected_provider: ev.selected_provider,
          selected_via: ev.selected_via,
          ...(ev.tier !== undefined ? { tier: ev.tier } : {}),
          ...(ev.rate_card_age_ms !== undefined ? { rate_card_age_ms: ev.rate_card_age_ms } : {}),
          ...(ev.rate_card_source !== undefined ? { rate_card_source: ev.rate_card_source } : {}),
          ...(ev.dimension !== undefined ? { dimension: ev.dimension } : {}),
          ...(resolvedModel !== undefined ? { model: resolvedModel } : {}),
        });
      },
      // Plan 03-04 (Phase 3 / G-R4) — pre-spawn cost projection. Wired ONLY
      // when `projectionActive` (projection_enabled !== false AND the
      // rate-card load succeeded AND a budget gate exists). The handler:
      // (1) projects the spawn cost via projectSpawnCost(...) — for the
      // orchestrator path the assembled system prompt IS the spawn prompt,
      // so promptWithOpts is passed as systemPrompt + '' as taskPrompt (the
      // projector sums both, so the token total is identical); (2) reads the
      // halt decision via gate.project(...); (3) emits cook.budget_projected
      // on EVERY projection (halt + pass) so the dashboard always sees the
      // forecast; (4) returns the result so runSpawnWithFallback decides the
      // throw. Best-effort discipline (research §6.2): any unexpected throw
      // from projectSpawnCost / gate.project is swallowed with a one-line
      // stderr notice and undefined is returned — runSpawnWithFallback then
      // proceeds with the spawn and the file-meter backstop stays the net.
      // The ONLY intentional spawn-aborting throw is
      // BudgetProjectionExceededError, raised by runSpawnWithFallback itself.
      onProjection: projectionActive
        ? (pctx) => {
            try {
              const projection = projectSpawnCost(
                {
                  systemPrompt: promptWithOpts,
                  taskPrompt: '',
                  maxTurns,
                  provider: pctx.provider,
                },
                rateCard as RateCard,
              );
              const result = projectionGate.project(projection);
              emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
                type: 'cook.budget_projected',
                ts: new Date().toISOString(),
                session_id: ctx.sessionId,
                sub_session_id: pctx.sub_session_id,
                projected_cost_usd: projection.projected_cost_usd,
                spent_usd: projectionGate.state().spent_usd,
                ceiling_usd: projectionGate.state().ceiling_usd,
                projected_pressure: result.projected_pressure,
                would_exceed: result.would_exceed,
                confidence: projection.confidence,
                assumptions: projection.assumptions.slice(0, 8),
                rate_card_source: projection.rate_card_source,
              });
              return result;
            } catch (err) {
              io.stderr.write(`swt cook: budget projection skipped (${String(err)}).\n`);
              return undefined;
            }
          }
        : undefined,
      // Production hook: forward fallback events to stderr so operators see
      // the transition (preserved verbatim for human visibility). Plan 02-04
      // (Phase 2 / G-R3) ADDS a dual-emit onto the cook events JSONL channel
      // as cook.provider_fallback so the dashboard sees provider transitions.
      onProviderEvent: (ev) => {
        io.stderr.write(
          `swt cook: provider fallback fired (from=${ev.from} to=${ev.to} ` +
            `reason=${ev.reason} attempt=${ev.attempt}).\n`,
        );
        emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
          type: 'cook.provider_fallback',
          ts: new Date().toISOString(),
          session_id: ctx.sessionId,
          sub_session_id: subSessionId,
          from: ev.from,
          to: ev.to,
          reason: ev.reason,
          attempt: ev.attempt,
        });
      },
    });
    const result = fallbackResult.result;

    // Phase 02 / Plan 02-01 — real Pi usage now flows through
    // `TaskResult.usage` (dispatcher.prompt wire-up). The dispatcher
    // subscribes to TASK_TOKEN_USAGE events for the duration of the
    // orchestrator prompt and accumulates per-turn deltas into the
    // returned envelope. Cache deltas are optional / provider-dependent —
    // Anthropic typically reports them, OpenAI does not always, so we
    // only emit the cache fields when the dispatcher saw a positive
    // count (avoid surfacing a misleading `0` when the provider stayed
    // silent).
    const resultStatus: 'completed' | 'failed' | 'blocked' =
      result.status === 'success' || result.status === 'partial'
        ? 'completed'
        : result.status === 'blocked'
          ? 'blocked'
          : 'failed';
    // Field-name remap: dispatcher's TaskResult.usage uses the canonical
    // `cache_read_tokens` / `cache_write_tokens` shape (provider-neutral),
    // but the on-wire CookUsageSchema (events.ts:161) is locked to the
    // Anthropic-style names `cache_read_input_tokens` /
    // `cache_creation_input_tokens` because the dashboard's cost
    // aggregator and statusline pipeline have read them this way since
    // alpha.10. Map at the emit boundary so neither schema has to churn.
    const resultUsage = {
      input_tokens: result.usage?.input_tokens ?? 0,
      output_tokens: result.usage?.output_tokens ?? 0,
      ...(result.usage?.cache_read_tokens !== undefined
        ? { cache_read_input_tokens: result.usage.cache_read_tokens }
        : {}),
      ...(result.usage?.cache_write_tokens !== undefined
        ? { cache_creation_input_tokens: result.usage.cache_write_tokens }
        : {}),
    };
    emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
      type: 'cook.agent_result',
      ts: new Date().toISOString(),
      session_id: ctx.sessionId,
      sub_session_id: subSessionId,
      status: resultStatus,
      usage: resultUsage,
    });

    // R5 (a)+(b) combined: emit live event AND fold the same usage payload
    // into the rolling .metrics/session-*.json aggregate. Plan 04-02's
    // reducer consumes the events; plan 04-04 statusline reads the file.
    // recordUsage is best-effort — a filesystem error must not break the
    // cook turn (the event channel already carries the live delta).
    try {
      recordUsage({
        sessionId: ctx.sessionId,
        ...(routing.phaseTarget !== undefined ? { phaseSlug: routing.phaseTarget } : {}),
        usage: resultUsage,
        planningRoot: joinPath(io.cwd, '.swt-planning'),
      });
    } catch {
      // swallow — see comment above.
    }

    if (result.status === 'failed' || result.status === 'blocked') {
      // Plan 06-01 T2 — task_fail then completion.
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.task_fail',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        plan: planLabel,
        task_id: taskId,
        reason: `spawn_${result.status}`.slice(0, 200),
      });
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.completion',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        status: 'failed',
      });
      // Plan 06-03 T2 — keep worktree for forensics on failed/blocked
      // status per TDD2 §9.7. The lock stays in place so `swt cleanup`
      // can decide whether to drop it after operator review.
      if (worktreeSession !== null) {
        await keepWorktreeForForensics(worktreeSession, `spawn_${result.status}`, io.stderr);
        worktreeSession = null;
      }
      // Flip execution-state to crashed so the next cook invocation's
      // resume probe sees the failure as a stale in_progress + dead pid.
      try {
        markCrashed(io.cwd);
      } catch {
        // best-effort
      }
      // alpha.22 — surface result.summary (carries Pi turn_end stopReason
      // body + augmented context for known upstream-failure patterns).
      // Pre-alpha.22 cook.ts dropped the summary entirely; only init.ts
      // surfaced it. Now both paths render identical, actionable failures
      // to the dashboard via the existing milestone-08 stderr-leak pipe.
      const augmented = augmentSpawnError(result.summary);
      const detail = augmented.length > 0 ? `\n\n${augmented}` : '';
      io.stderr.write(
        `swt cook: orchestrator session returned status="${result.status}".${detail}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }

    // Plan 06-01 T2 — happy path emits task_commit (if a fresh commit is
    // observable on HEAD) and task_complete before cook.completion.
    const commitHash = tryReadHeadCommit(io.cwd, deps.execSyncFn);
    if (commitHash !== undefined && commitHash.length > 0) {
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.task_commit',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        plan: planLabel,
        task_id: taskId,
        commit_hash: commitHash,
      });
    }
    emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
      type: 'cook.task_complete',
      ts: new Date().toISOString(),
      session_id: ctx.sessionId,
      plan: planLabel,
      task_id: taskId,
    });
    emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
      type: 'cook.completion',
      ts: new Date().toISOString(),
      session_id: ctx.sessionId,
      status: 'success',
    });
    // Plan 06-03 T2 — happy path: harvest + remove the worktree. The
    // remove() call releases the per-task lock; commits made inside the
    // worktree stay on the worktree's branch (operator-driven merge is
    // out of scope for v3.0 — the chaos test asserts the staging-area
    // isolation, merge integration is v3.1).
    if (worktreeSession !== null) {
      await releaseWorktreeOnSuccess(worktreeSession, io.stderr);
      worktreeSession = null;
    }
    try {
      markCompleted(io.cwd);
    } catch {
      // best-effort — see recordRunModeStart for rationale.
    }
    return EXIT.SUCCESS;
  } catch (err) {
    // Plan 03-04 (Phase 3 / G-R4) — pre-spawn budget halt. The onProjection
    // handler returned a would_exceed result, so runSpawnWithFallback threw
    // BudgetProjectionExceededError BEFORE the fallback chain ran — spawnFn
    // was never reached, no money was spent. The cook.budget_projected event
    // (with would_exceed: true) was ALREADY emitted by the handler, so the
    // dashboard has the forecast; here we mirror the paused_on_entry failure
    // shape: cook.task_fail + cook.completion(failed) with the analogous
    // reason 'budget_projection_exceeded', then return EXIT.RUNTIME_ERROR.
    // Ordered BEFORE the generic error handling (instanceof check). The gate
    // handle dispose + worktree cleanup happen in the shared `finally` below.
    if (err instanceof BudgetProjectionExceededError) {
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.task_fail',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        plan: planLabel,
        task_id: taskId,
        reason: 'budget_projection_exceeded',
      });
      emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
        type: 'cook.completion',
        ts: new Date().toISOString(),
        session_id: ctx.sessionId,
        status: 'failed',
      });
      // No spawn ran — release the worktree (nothing to keep for forensics,
      // unlike the spawn-failed path). The `finally` disposes the gate.
      if (worktreeSession !== null) {
        await releaseWorktreeOnSuccess(worktreeSession, io.stderr);
        worktreeSession = null;
      }
      try {
        markCrashed(io.cwd);
      } catch {
        // best-effort
      }
      io.stderr.write(`swt cook: ${err.message} — spawn aborted, no spend.\n`);
      return EXIT.RUNTIME_ERROR;
    }
    const message = err instanceof Error ? err.message : String(err);
    emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
      type: 'cook.error',
      ts: new Date().toISOString(),
      session_id: ctx.sessionId,
      code: 'ORCHESTRATOR_SPAWN_FAILED',
      message,
      mode: routing.mode,
    });
    // Plan 06-01 T2 — fail variant carries a truncated reason string.
    emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
      type: 'cook.task_fail',
      ts: new Date().toISOString(),
      session_id: ctx.sessionId,
      plan: planLabel,
      task_id: taskId,
      reason: message.slice(0, 200),
    });
    emitCookEvent(io.cwd, ctx.sessionId, ctx.startTs, {
      type: 'cook.completion',
      ts: new Date().toISOString(),
      session_id: ctx.sessionId,
      status: 'failed',
    });
    try {
      markCrashed(io.cwd);
    } catch {
      // best-effort
    }
    io.stderr.write(`swt cook: orchestrator spawn failed: ${message}\n`);
    return EXIT.RUNTIME_ERROR;
  } finally {
    // Plan 06-02 T4 — dispose the BudgetGate + chokidar watcher. The
    // unsubscribe + watcher.close() are both best-effort; a transient
    // filesystem error here must NOT mask the upstream return value.
    if (gateUnsubscribe !== undefined) {
      try {
        gateUnsubscribe();
      } catch {
        // best-effort
      }
    }
    if (budgetGateHandle?.dispose !== undefined) {
      try {
        await budgetGateHandle.dispose();
      } catch {
        // best-effort
      }
    }
    // Plan 06-03 T2 — catch path / orphaned worktree cleanup. If the
    // success / failed branches above already disposed the worktree they
    // null it out; if we reach this point with a non-null session it
    // means an uncaught error skipped the disposition branches. Keep the
    // worktree for forensics per TDD2 §9.7.
    if (worktreeSession !== null) {
      await keepWorktreeForForensics(worktreeSession, 'uncaught_error', io.stderr);
    }
  }
}

/**
 * Append the ModeOptions + phase-target context as a structured trailer
 * to the prompt body. The orchestrator reads this in its first turn.
 */
function appendModeOptions(
  prompt: string,
  opts: ModeOptions,
  routing: RoutingDecision,
  refHash: string | undefined,
): string {
  const trailer: string[] = ['', '---', ''];
  trailer.push('## Orchestrator-Side Context (Plan 03-02)');
  trailer.push('');
  trailer.push(`- routing.mode: ${routing.mode}`);
  trailer.push(`- routing.priority: ${routing.priority}`);
  if (routing.phaseTarget !== undefined) {
    trailer.push(`- routing.phaseTarget: ${routing.phaseTarget}`);
  }
  if (opts.effort !== undefined) trailer.push(`- effort: ${opts.effort}`);
  if (opts.skipQa) trailer.push(`- skip_qa: true`);
  if (opts.skipAudit) trailer.push(`- skip_audit: true`);
  if (opts.yolo) trailer.push(`- yolo: true`);
  if (opts.planTarget !== undefined) trailer.push(`- plan_target: ${opts.planTarget}`);
  if (opts.phaseTarget !== undefined) trailer.push(`- phase_target: ${opts.phaseTarget}`);
  if (refHash !== undefined) trailer.push(`- ref_hash: ${refHash}`);
  return `${prompt}\n${trailer.join('\n')}\n`;
}

function isAcceptResponse(response: AskUserResponse): boolean {
  if (response.selectedOption === null) return false;
  // Match the "Yes" option label — case-insensitive substring + the
  // canonical 'yes' / 'accept' variants. The recommended-option auto-
  // accept path always picks the first option (Yes); freeform responses
  // never satisfy the gate.
  const lower = response.selectedOption.toLowerCase();
  return (
    lower === 'yes' ||
    lower.includes('yes') ||
    lower.includes('accept') ||
    lower.includes('proceed') ||
    lower.includes('continue')
  );
}

/**
 * Build the `${SWT_PHASE_DETECT_OUTPUT}` placeholder value. Currently emits
 * a compact JSON stringification keyed by the routing-relevant fields. The
 * orchestrator body has its own KEY=VALUE rendering when needed
 * (commands/cook.md renders the same shape).
 */
function stringifyPhaseDetect(state: PhaseDetectResult): string {
  return JSON.stringify(state, null, 2);
}

function resolveInstallRoot(): string {
  return process.env['SWT_INSTALL_ROOT'] ?? process.cwd();
}

function resolveSessionId(): string {
  // SWT_SESSION_ID is set by applyEnvToProcess() at CLI bootstrap. The
  // ?? fallback covers the test path where applyEnvToProcess is not
  // called (tests inject the env directly when needed).
  return (
    process.env['SWT_SESSION_ID'] ??
    `cook-${Math.random().toString(16).slice(2, 10)}-${Date.now().toString(16)}`
  );
}

/**
 * Default `cookHandler` — production-wired. Tests use `makeCookHandler({...})`.
 */
export const cookHandler: CommandHandler = makeCookHandler();
