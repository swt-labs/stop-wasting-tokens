/**
 * Plan 01-03 (Phase 1) — Pi-substrate primitive 3: `swt:fireHook`.
 *
 * Vocabulary + registration schema for the hook dispatcher (TDD3 §8 + §14,
 * REQ-01 / REQ-06). The 12 event names below cover the full CC hook
 * vocabulary mapped to Pi event sources per research §4 (one row per CC
 * hook event). Phase 1 wires 5 of them (SessionStart, Stop, PreToolUse,
 * PostToolUse, SubagentStart, SubagentStop); the remaining names (PreCompact,
 * PostCompact, TaskCompleted, TeammateIdle, UserPromptSubmit, Notification)
 * are reserved so Phase F can extend `config/hooks.json` without breaking
 * the dispatcher's type contract.
 */

/**
 * The 12 CC hook event names recognised by the dispatcher. Phase 1 wires
 * SessionStart, Stop, PreToolUse, PostToolUse, SubagentStart, SubagentStop;
 * the rest are vocabulary placeholders for Phase F (TDD3 §8.1 / §20.4).
 */
export type HookEvent =
  | 'SessionStart'
  | 'Stop'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Notification'
  | 'PreCompact'
  | 'PostCompact'
  | 'TaskCompleted'
  | 'TeammateIdle'
  | 'UserPromptSubmit';

/**
 * Per-event matcher — every field is optional; an absent field is a
 * wildcard. The `tool` field accepts a literal string OR a `RegExp` for
 * matchers like `/Write|Edit|MultiEdit/` per the plan's config.json seed.
 *
 * Wire form: JSON cannot carry a `RegExp` directly. `config/hooks.json`
 * encodes regex matchers as `{ tool: "Write|Edit|MultiEdit" }` (a string
 * that the loader compiles to `new RegExp(...)`). Literal-match keeps a
 * plain string. A `null` matcher means "match every event of this type"
 * (used by always-fire informational hooks like `validate-commit`).
 */
export interface HookMatcher {
  readonly tool?: string | RegExp;
  readonly role?: string;
}

/**
 * Single registration row: which `event` to fire on, what `matcher` selects
 * the dispatch (null = wildcard), which `scriptPath` runs, and how long
 * before the wrapper treats the script as misbehaving + degrades to
 * `'allow' | 'no-op'`.
 *
 * `scriptPath` is resolved against `SWT_INSTALL_ROOT` when relative. `env`
 * overlays on top of the dispatcher's default env (which already contains
 * `SWT_INSTALL_ROOT`, `SWT_SESSION_ID`, and `SWT_CONFIG_ROOT`).
 */
export interface HookRegistration {
  readonly event: HookEvent;
  readonly matcher: HookMatcher | null;
  readonly scriptPath: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Default `5000` (5s). PreToolUse uses this as a hard ceiling. */
  readonly timeoutMs?: number;
}

/**
 * Per-dispatch context threaded into every spawn. `toolName`, `toolInput`,
 * `toolResult` are populated only for the events that carry them; the rest
 * are always present.
 */
export interface HookContext {
  readonly sessionId: string;
  readonly installRoot: string;
  readonly cwd: string;
  readonly toolName?: string;
  readonly toolInput?: unknown;
  readonly toolResult?: unknown;
  /**
   * Role bound to the spawn (`'dev'`, `'qa'`, etc.). Carried for
   * `bash-guard.sh`'s `VBW_AGENT_ROLE` env binding and for the
   * `matcher.role` field. Optional because top-level orchestrator hooks
   * (`SessionStart`, `Stop`) don't have a role.
   */
  readonly role?: string;
}

/** PreToolUse decision returned by `dispatchPreTool`. */
export type HookDecision = 'allow' | 'block';
