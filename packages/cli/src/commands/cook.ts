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
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath, join as joinPath } from 'node:path';

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
  type ExecutionStateRecord,
  type PhaseDetectResult,
} from '@swt-labs/methodology';
import {
  spawnOrchestratorSession,
  defaultPidChecker,
  createProviderRouter,
  createFallbackChain,
  FallbackChainExhaustedError,
  type PidChecker,
  type ProviderFallbackEvent,
  type FallbackFailureReason,
  type RouterStrategy,
  type RouterTier,
} from '@swt-labs/orchestration';
import type { TaskBrief } from '@swt-labs/shared';
import { askUser as defaultAskUser, type AskUserResponse } from '@swt-labs/runtime';
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
  // Lazy import readdirSync to avoid widening the module top-level imports
  // (cook.ts already does file IO via fs/promises in places; sync is fine
  // here — the probe runs once at cookHandler entry).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const readdir = readdirSyncImpl ?? ((d: string): string[] => require('node:fs').readdirSync(d));
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
      ? lastStart.task_id ?? 'unknown'
      : lastCommit !== undefined && lastCommit.task_id !== undefined
        ? `${lastCommit.task_id}_next`
        : lastStart?.task_id ?? 'unknown';

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
export type DebugOnlyRole =
  | 'scout'
  | 'architect'
  | 'lead'
  | 'dev'
  | 'qa'
  | 'debugger'
  | 'docs';

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
 * Cook configuration (subset of `.swt-planning/config.json` the cook handler
 * reads). Tests inject the shape; production reads from disk via
 * `loadCookConfig`.
 */
export interface CookConfig {
  readonly auto_uat: boolean;
  readonly agent_max_turns_orchestrator?: number;
  readonly qa_gate_overrides?: QaGateOverrides;
  readonly providers: CookProvidersConfig;
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

function normaliseEffort(
  raw: string | boolean | undefined,
): ModeOptions['effort'] | undefined {
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
    if (
      state.first_qa_attention_phase !== undefined &&
      state.qa_attention_status === 'failed'
    ) {
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
    if (
      state.first_qa_attention_phase !== undefined &&
      state.qa_attention_status === 'failed'
    ) {
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
    if (
      state.first_qa_attention_phase !== undefined &&
      state.qa_attention_status === 'failed'
    ) {
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
    if (
      state.first_qa_attention_phase !== undefined &&
      state.qa_attention_status === 'pending'
    ) {
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
 * Extract a `### Mode: …` section from `commands/cook.md`. The slice runs
 * from the matching heading to the NEXT `### Mode:` heading (exclusive) or
 * EOF, whichever comes first.
 */
export function extractModeSection(body: string, modeHeading: string): string {
  const startIdx = body.indexOf(modeHeading);
  if (startIdx === -1) {
    throw new Error(
      `cook: could not find mode section "${modeHeading}" in commands/cook.md`,
    );
  }
  const afterStart = startIdx + modeHeading.length;
  const nextIdx = body.indexOf('\n### Mode:', afterStart);
  return nextIdx === -1 ? body.slice(startIdx) : body.slice(startIdx, nextIdx);
}

/**
 * Substitute placeholder strings (`${SWT_INSTALL_ROOT}`,
 * `${SWT_PHASE_DETECT_OUTPUT}`) in the prompt body. Other placeholders
 * pass through unmodified for the LLM to interpret.
 */
export function substitutePlaceholders(
  body: string,
  installRoot: string,
  phaseDetectOutput: string,
): string {
  return body
    .replace(/\$\{SWT_INSTALL_ROOT\}/g, installRoot)
    .replace(/\$\{SWT_PHASE_DETECT_OUTPUT\}/g, phaseDetectOutput);
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
  fsImpl: { readFileSync: typeof readFileSync } = { readFileSync },
): string {
  const cookMdPath = resolvePath(installRoot, 'commands', 'cook.md');
  const raw = fsImpl.readFileSync(cookMdPath, 'utf8');
  const body = stripFrontmatter(raw);
  const heading = MODE_HEADING[mode];
  const section = extractModeSection(body, heading);
  return substitutePlaceholders(section, installRoot, phaseDetectOutput);
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
    typeof block['retryBudget'] === 'number' && Number.isFinite(block['retryBudget']) && (block['retryBudget'] as number) >= 1
      ? (block['retryBudget'] as number)
      : DEFAULT_PROVIDERS_CONFIG.retryBudget;
  const timeBudgetMs =
    typeof block['timeBudgetMs'] === 'number' && Number.isFinite(block['timeBudgetMs']) && (block['timeBudgetMs'] as number) > 0
      ? (block['timeBudgetMs'] as number)
      : DEFAULT_PROVIDERS_CONFIG.timeBudgetMs;
  return { strategy, fallbacks, retryBudget, timeBudgetMs };
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
      return typeof obj['map'] === 'object' && obj['map'] !== null && typeof obj['fallback'] === 'string'
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
    return { auto_uat: false, providers: DEFAULT_PROVIDERS_CONFIG };
  }
  try {
    const raw = fsImpl.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const autoUat =
      typeof parsed['auto_uat'] === 'boolean' ? (parsed['auto_uat'] as boolean) : false;
    const overrides =
      typeof parsed['qa_gate_overrides'] === 'object' && parsed['qa_gate_overrides'] !== null
        ? (parsed['qa_gate_overrides'] as QaGateOverrides)
        : undefined;
    const maxTurns =
      typeof parsed['agent_max_turns'] === 'object' && parsed['agent_max_turns'] !== null
        ? (parsed['agent_max_turns'] as Record<string, unknown>)['orchestrator']
        : undefined;
    const providers = parseProvidersConfig(parsed['providers']);
    return {
      auto_uat: autoUat,
      providers,
      ...(overrides !== undefined ? { qa_gate_overrides: overrides } : {}),
      ...(typeof maxTurns === 'number' && Number.isFinite(maxTurns)
        ? { agent_max_turns_orchestrator: maxTurns }
        : {}),
    };
  } catch {
    return { auto_uat: false, providers: DEFAULT_PROVIDERS_CONFIG };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level handler
// ────────────────────────────────────────────────────────────────────────────

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
        },
        { askUserFn, spawnFn, execSyncFn, readFileSyncFn },
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
          options: [
            { label: 'Yes', isRecommended: true },
            { label: 'No' },
          ],
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
          },
          { askUserFn, spawnFn, execSyncFn, readFileSyncFn },
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
      if (
        process.env['NODE_ENV'] !== 'test' &&
        process.env['SWT_ALLOW_DEBUG_ROLE'] !== '1'
      ) {
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
        options: [
          { label: 'Yes', isRecommended: true },
          { label: 'No' },
        ],
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
            ...(routing.phaseTarget !== undefined
              ? { phaseTarget: routing.phaseTarget }
              : {}),
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
          },
          { askUserFn, spawnFn, execSyncFn, readFileSyncFn },
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
      },
      { askUserFn, spawnFn, execSyncFn, readFileSyncFn },
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
}

interface RunModeDeps {
  readonly askUserFn: typeof defaultAskUser;
  readonly spawnFn: typeof spawnOrchestratorSession;
  readonly execSyncFn: typeof nodeExecSync;
  readonly readFileSyncFn: typeof readFileSync;
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
async function checkBoundarySignal(
  sessionId: string,
  controls: CookControlsConfig,
): Promise<void> {
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
function tryReadHeadCommit(
  cwd: string,
  execSyncFn: typeof nodeExecSync,
): string | undefined {
  try {
    return execSyncFn('git log -1 --format=%H', { cwd, encoding: 'utf8' }).toString().trim();
  } catch {
    return undefined;
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
    const planEntry = phaseTarget !== undefined
      ? [{ plan: phaseTarget, status: 'in_progress' as const }]
      : [];
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
 * Plan 06-02 T4 — map `CookProviderStrategy` (config-shape) to
 * `RouterStrategy` (orchestration-shape). The only meaningful difference
 * is the `tier-routed` map key type — config accepts `Record<string,...>`
 * while the router uses `Partial<Record<Tier,...>>`. Filtering down to
 * known tier names keeps the router contract clean.
 */
function toRouterStrategy(strategy: CookProviderStrategy): RouterStrategy {
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
  }
}

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
  const primary = router.select({ task: opts.taskBrief, tier });
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
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const selection = chain.select(opts.taskBrief);
    try {
      const result = await opts.spawnFn(opts.spawnArgs);
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

  // Load the cook.md mode section + substitute placeholders.
  const prompt = loadCookModeSection(
    ctx.installRoot,
    routing.mode,
    ctx.phaseDetectOutput,
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

  try {
    // Plan 06-02 T3 (REQ-15) — provider router + fallback chain. The
    // chain is per-spawn; an empty fallback list (the default) yields a
    // degenerate one-attempt chain that preserves today's single-provider
    // behavior. Multi-provider deployments opt in via `.swt-planning/
    // config.json#providers`.
    const fallbackTaskBrief: TaskBrief = {
      taskId: taskId,
      role: 'orchestrator',
      cwd: io.cwd,
    };
    const fallbackResult = await runSpawnWithFallback({
      providers: config.providers,
      spawnArgs: {
        prompt: promptWithOpts,
        cwd: io.cwd,
        sessionId: ctx.sessionId,
        installRoot: ctx.installRoot,
        maxTurns,
      },
      spawnFn: deps.spawnFn,
      taskBrief: fallbackTaskBrief,
      // Production hook: forward fallback events to stderr so operators
      // see the transition. The cook events JSONL channel doesn't have a
      // dedicated schema entry for provider transitions (today); a future
      // plan adds `cook.provider_fallback` if dashboards need it.
      onProviderEvent: (ev) => {
        io.stderr.write(
          `swt cook: provider fallback fired (from=${ev.from} to=${ev.to} ` +
            `reason=${ev.reason} attempt=${ev.attempt}).\n`,
        );
      },
    });
    const result = fallbackResult.result;

    // TaskResult (TDD2 §9.4 swt_report_result envelope) does not carry a
    // `usage` payload today — Pi's per-turn token deltas are plumbed in
    // Phase 5 parity testing (research §Recommendation 5). Emit zero-token
    // sentinels here; plan 04-04 / Phase 5 will replace this with the
    // real Pi usage payload once it's exposed through the harvest channel.
    // TODO(Phase 5 parity): plumb usage from Pi session handle.
    const resultStatus: 'completed' | 'failed' | 'blocked' =
      result.status === 'success' || result.status === 'partial'
        ? 'completed'
        : result.status === 'blocked'
          ? 'blocked'
          : 'failed';
    const resultUsage = { input_tokens: 0, output_tokens: 0 };
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
      // Flip execution-state to crashed so the next cook invocation's
      // resume probe sees the failure as a stale in_progress + dead pid.
      try {
        markCrashed(io.cwd);
      } catch {
        // best-effort
      }
      io.stderr.write(
        `swt cook: orchestrator session returned status="${result.status}".\n`,
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
    try {
      markCompleted(io.cwd);
    } catch {
      // best-effort — see recordRunModeStart for rationale.
    }
    return EXIT.SUCCESS;
  } catch (err) {
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
  return lower === 'yes' || lower.includes('yes') || lower.includes('accept') || lower.includes('proceed') || lower.includes('continue');
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
