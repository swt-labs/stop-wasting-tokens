/**
 * `swt:spawnAgent` — the public Pi-substrate primitive for launching a
 * role-bound Pi session.
 *
 * Wraps `createDispatcher` with: role-aware system prompt (read from
 * `agents/swt-{role}.md`), role-aware Pi tool subset (from `toolsForRole`),
 * Result Protocol extension (`buildResultProtocolExtension`), and per-session
 * transcript persistence (`buildJournalExtension({sink: FileJournalSink(...)})`
 * pointed at `.swt-planning/.transcripts/{sessionId}.jsonl` per TDD3 §20.2).
 *
 * Phase 1 Plan 01-01 Task T03.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * // Pi API verification (research §7 risks 1+2) — Task T01 findings
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Verified against the Pi 0.74 SDK type definitions at
 * `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts`
 * (CreateAgentSessionOptions interface, lines 11-55):
 *
 *   `CreateAgentSessionOptions` EXPOSES (as Phase 1 needs):
 *     - cwd?: string                               (line 13)
 *     - model?: Model<any>                         (line 21)
 *     - thinkingLevel?: ThinkingLevel              (line 23)
 *     - customTools?: ToolDefinition[]             (line 46)  ← per-role tools
 *     - sessionManager?: SessionManager            (line 50)
 *     - tools?: string[]                           (line 44)  ← built-in allow
 *     - noTools?: "all" | "builtin"                (line 36)
 *
 *   `CreateAgentSessionOptions` DOES NOT expose:
 *     - systemPrompt    — there is a `systemPrompt` getter on the constructed
 *                         AgentSession (agent-session.d.ts:261) but no input
 *                         option to set it from outside. Phase 1 prepends the
 *                         rendered prompt to the first session.prompt() call.
 *                         (Recorded on the session config so the dispatcher
 *                         can prepend it at prompt time once real Pi wiring
 *                         lands in the runtime session-wiring follow-up.)
 *     - maxTurns        — no top-level option. Enforced at the orchestrator
 *                         layer when implemented; recorded on session config
 *                         for now (Phase 1 just plumbs the default from
 *                         `config/defaults.json` `agent_max_turns[role]`).
 *     - extensions      — Pi's extension *factories* (the shape
 *                         `(pi: PiExtensionAPI) => void`) are NOT acceptable
 *                         as an input on `createAgentSession`. They are
 *                         loaded via `main()`'s `MainOptions.extensionFactories`
 *                         (`main.d.ts:9`) — i.e., only at CLI bootstrap. The
 *                         programmatic seam to convert them into runtime
 *                         tool registrations is `customTools[]`, but that
 *                         path also handles the `pi.on(...)` listeners.
 *                         Phase 1 RECORDS the factories on the session
 *                         config (`extensions[]`); the upstream session-
 *                         wiring follow-up will materialise them into
 *                         customTools[] + `pi.on(...)` registrations. This
 *                         matches the existing precedent for
 *                         `enableResultProtocol` (see runtime/src/session.ts
 *                         lines 38-46 / 78-84).
 *     - beforeToolExecution — no pre-execution intercept callback. This is
 *                         a plan 01-03 (swt:fireHook) concern, not a plan
 *                         01-01 concern. Recorded here for completeness.
 *
 *                         Plan 01-03 task 3 re-verification: the Pi 0.74
 *                         internal AgentSession DOES install a private
 *                         `beforeToolCall` hook on its underlying Agent
 *                         (see `agent-session.js` ~line 170), but it only
 *                         forwards `tool_call` events to the Pi extension
 *                         runner. Since extensions are loaded only at
 *                         CLI bootstrap via `MainOptions.extensionFactories`
 *                         (NOT through `createAgentSession`), the
 *                         programmatic-spawn path has no usable
 *                         pre-execution gate. Plan 01-03 implements
 *                         PreToolUse as advisory via
 *                         `dispatcher.subscribeToSession()`; the would-be-
 *                         block decisions are still logged through the
 *                         HookEventBus. A real gate is reachable only
 *                         when a customTool wrapper calls
 *                         `dispatcher.dispatchPreTool()` synchronously
 *                         before delegating to the underlying tool body
 *                         (Phase F hardening). See
 *                         packages/runtime/src/hooks/dispatcher.ts head
 *                         comment for the TODO(Phase F) anchor.
 *
 *   ⇒ Phase 1 implication: spawnAgent's resolved per-role config (system
 *     prompt, tools, extensions, maxTurns, thinkingLevel) is captured in
 *     `SpawnAgentSessionConfig` and passed through a `SpawnAgentSessionFactory`
 *     closure. The default factory calls `createSession(opts)` and Pi-wires
 *     the recorded fields when the runtime adapter is updated to consume them.
 *     Tests inject a recording factory that asserts on the config directly,
 *     so the spawnAgent contract is verifiable today without real Pi.
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildJournalExtension,
  buildResultProtocolExtension,
  createHookDispatcher,
  createSession,
  FileJournalSink,
  loadHookRegistrationsFromConfig,
  resolveThinkingLevelForRole,
  type HookDispatcher,
  type HookEventBus,
  type HookRegistration,
  type JournalSink,
  type PiExtensionAPI,
  type SwtSession,
  type SwtSessionOptions,
  type ThinkingLevel,
} from '@swt-labs/runtime';
import type { AgentRole, AuthMode, TaskBrief, TaskResult } from '@swt-labs/shared';

import { createDispatcher, type SessionFactory } from './dispatcher.js';
import { readRolePromptWithMeta } from './prompt-builder.js';
import { readProviderOverlay } from './provider-overlay.js';
import { toolsForRole, type AgentToolList } from './role-router.js';

/**
 * Default `agent_max_turns` map from `config/defaults.json`. Inlined here so
 * the orchestration layer doesn't take a hard dependency on `cli/` for the
 * config-loading layer. Phase 3 wires the full config-resolution chain
 * (Open Question 5); for Phase 1 this is the floor.
 */
const DEFAULT_AGENT_MAX_TURNS: Readonly<Record<AgentRole, number>> = {
  // Pulled verbatim from config/defaults.json#agent_max_turns at Phase 1.
  // docs is not in defaults yet (config/defaults.json predates AgentRole's
  // 'docs' entry); default it to dev's 75 — Phase 3 will add the canonical
  // entry to config.
  orchestrator: 100,
  scout: 15,
  qa: 25,
  architect: 30,
  debugger: 80,
  lead: 50,
  dev: 75,
  docs: 75,
};

/**
 * Role → sandbox mode. Defaults follow the agent frontmatter:
 *   - scout, qa: `plan` permissionMode → `read-only` sandbox
 *   - everyone else: `acceptEdits` → `workspace-write`
 *
 * Plan 01-01 carries the architect `permissionMode: acceptEdits` decision
 * forward from research §6.2 — TDD3 §5 listed `plan` but the ported
 * frontmatter says `acceptEdits`. Captured as a deviation in SUMMARY.md.
 */
function defaultSandboxModeForRole(
  role: AgentRole,
): NonNullable<SwtSessionOptions['meterContext']> extends never
  ? never
  : 'read-only' | 'workspace-write' {
  if (role === 'scout' || role === 'qa') return 'read-only';
  return 'workspace-write';
}

/**
 * Resolved per-spawn session configuration. The default factory passes this
 * through to runtime `createSession` (which records but does not yet activate
 * the new fields — pending the Pi session-wiring follow-up). Tests inject a
 * recording factory that asserts on each field.
 *
 * Extends `SwtSessionOptions` so the new fields layer on top of the existing
 * meter / result-protocol / taskId plumbing without breaking the dispatcher's
 * `SessionFactory` contract.
 */
export interface SpawnAgentSessionConfig extends SwtSessionOptions {
  /**
   * Role-specific system prompt (full file body of `agents/swt-{role}.md`).
   * Pi 0.74 has no `systemPrompt` input option on `createAgentSession`; the
   * dispatcher prepends it to the first `prompt()` call when real Pi wiring
   * lands. Recorded here so the test can assert against the resolved
   * content.
   */
  readonly systemPrompt: string;
  /** Role-aware Pi tool list from `toolsForRole(role, cwd)`. */
  readonly tools: AgentToolList;
  /**
   * Pi extension factories registered on this session. Includes (always)
   * the Result Protocol extension AND the Journal extension. Pi's
   * `createAgentSession` doesn't accept these directly — Phase 1 records
   * them; the runtime session-wiring follow-up materialises them into
   * `customTools[]` + `pi.on(...)` registrations.
   */
  readonly extensions: ReadonlyArray<SpawnAgentExtension>;
  /**
   * Absolute path the transcript JSONL will be written to —
   * `<cwd>/.swt-planning/.transcripts/<sessionId>.jsonl` per TDD3 §20.2.
   */
  readonly transcriptPath: string;
  /**
   * Maximum turns this session is allowed before the orchestrator forcibly
   * ends it. Sourced from agent frontmatter (Phase 02) > caller opts
   * (`SpawnAgentOptions.maxTurns`) > role default
   * (`DEFAULT_AGENT_MAX_TURNS[role]`).
   */
  readonly maxTurns: number;
  /**
   * Pi `ThinkingLevel`. Sourced from agent frontmatter `effort:` (Phase 02)
   * > `resolveThinkingLevelForRole(role)` default. There is no caller-level
   * override field today — `effort` is purely frontmatter-or-default.
   */
  readonly thinkingLevel: ThinkingLevel;
  /** Provider sandbox mode (maps to Pi `permissionMode` semantics). */
  readonly sandboxMode: 'read-only' | 'workspace-write';
  /** The originating role for the spawned session. */
  readonly role: AgentRole;
}

export interface SpawnAgentExtension {
  /** Human-readable name for test assertions / debugging. */
  readonly name: 'resultProtocol' | 'journal';
  /** Pi extension factory — invoked once at session start with `PiExtensionAPI`. */
  readonly factory: (pi: PiExtensionAPI) => void;
}

/** Factory used internally by spawnAgent to create the per-task Pi session. */
export type SpawnAgentSessionFactory = (config: SpawnAgentSessionConfig) => Promise<SwtSession>;

/**
 * Default factory — forwards to the runtime's `createSession` and drops the
 * spawn-specific fields. The runtime records them structurally (consistent
 * with the existing `enableResultProtocol` precedent at
 * `runtime/src/session.ts:78`) and activates them when the Pi session-wiring
 * follow-up lands.
 */
const defaultSpawnSessionFactory: SpawnAgentSessionFactory = async (config) => {
  // Strip spawn-specific fields before passing to the runtime — the
  // runtime accepts the superset via type widening (see session.ts).
  const sessionOpts: SwtSessionOptions = {
    cwd: config.cwd,
    ephemeral: config.ephemeral,
    enableResultProtocol: config.enableResultProtocol ?? true,
    taskId: config.taskId,
    ...(config.meter !== undefined ? { meter: config.meter } : {}),
    ...(config.meterContext !== undefined ? { meterContext: config.meterContext } : {}),
    // Phase 2 — forward provider/model/resolvedCredential to `createSession`
    // using the same conditional-spread pattern as meter/meterContext so an
    // absent field stays absent (not `undefined`-valued) and a no-credential
    // spawn produces a `SwtSessionOptions` byte-identical to pre-Phase-2.
    // Symmetric with `defaultOrchestratorSessionFactory` — this is the link
    // that carries the resolved credential into `createSession`'s in-memory
    // AuthStorage-injection branch (02-02).
    ...(config.provider !== undefined ? { provider: config.provider } : {}),
    ...(config.model !== undefined ? { model: config.model } : {}),
    ...(config.resolvedCredential !== undefined
      ? { resolvedCredential: config.resolvedCredential }
      : {}),
    // Phase 02 (plan 02-01 T1) — propagate `thinkingLevel` from the resolved
    // `SpawnAgentSessionConfig` (already required on the config since plan
    // 01-01) into `SwtSessionOptions`. Mirrors the provider/model conditional-
    // spread precedent above. Closes the silent-drop bug: pre-Phase-02 the
    // factory stripped `thinkingLevel` before reaching `createSession`, so the
    // Pi-native option was never set on the session.
    ...(config.thinkingLevel !== undefined ? { thinkingLevel: config.thinkingLevel } : {}),
  };
  return createSession(sessionOpts);
};

/**
 * Public `swt:spawnAgent` surface (TDD3 §14 primitive 1).
 *
 * Per TDD3, spawnAgent's *user-facing* signature is
 * `spawnAgent(role, prompt, model, maxTurns)` — model and maxTurns optional.
 * In TypeScript we surface it as an options-object so callers don't have to
 * thread positional `undefined`s. The `model`/`maxTurns` fields default per
 * the resolution rules above; `cwd`, `sessionId`, `installRoot` are required
 * runtime-context fields the orchestrator supplies (plan 01-02 lands the
 * standalone `swt:installRoot()` / `swt:sessionId()` accessors).
 */
export interface SpawnAgentOptions {
  /** Methodology role to spawn (must NOT be `'orchestrator'`). */
  readonly role: AgentRole;
  /** Task prompt body (the "what to do" sent into the agent's first turn). */
  readonly prompt: string;
  /**
   * Override the role's default model id. Optional (Phase 1 ignores it —
   * see Open Question 5).
   *
   * Phase 2 — now threaded through `resolveSpawnAgentConfig` →
   * `defaultSpawnSessionFactory` → `createSession`, but Phase 2 still leaves
   * it unset per Risk 8 (Pi's ModelRegistry resolves the default).
   */
  readonly model?: string;
  /**
   * Optional provider id (e.g., `'openai'`, `'anthropic'`,
   * `'openrouter/anthropic/claude-...'`). When supplied AND
   * `<installRoot>/provider_overlays/<role>-<provider>.md` exists, the
   * file body is appended to the resolved system prompt with `\n\n---\n\n`
   * separator (per Phase G / Phase 1 R1 decision — methodology contract
   * first, overlay is execution-style refinement). When `undefined` or
   * when no overlay file exists, behavior is byte-identical to pre-
   * Phase-1 (vendor-neutrality preservation per R4 — every non-OpenAI
   * spawn hits this no-op path). Resolved by the caller (R2: cook's
   * `runSpawnWithFallback` threads the router-selected provider here);
   * spawn paths do not re-instantiate the router. G-R1 / G-M1.
   *
   * Phase 2 — `provider` is now ALSO the provider id the resolved
   * credential is `.set()` for in `createSession`.
   */
  readonly provider?: string;
  /**
   * Phase 2 (Selection → Spawn Wiring) — the keychain-resolved credential
   * for `provider`, supplied by the cook spawn callsite (02-04). Same shape
   * as `SwtSessionOptions.resolvedCredential`. `secret` is a SECRET — never
   * log or serialize it. Forwarded to `createSession` for in-memory
   * AuthStorage injection. `undefined` ⇒ byte-identical to pre-Phase-2.
   */
  readonly resolvedCredential?: {
    readonly authMode: AuthMode;
    readonly secret: string;
  };
  /** Override the role's default max-turns. Optional (defaults to `agent_max_turns[role]`). */
  readonly maxTurns?: number;
  /** Working directory the spawned session is rooted at. */
  readonly cwd: string;
  /**
   * Stable session id (UUID) used for the transcript filename. Plan 01-02
   * wires this from a runtime-level `swt:sessionId()`; for Phase 1 the
   * caller passes it explicitly.
   */
  readonly sessionId: string;
  /**
   * Install root (where `agents/`, `scripts/`, `templates/` live). Plan
   * 01-02 wires `swt:installRoot()`; Phase 1 takes it as an explicit param.
   * Used to resolve the role's system prompt at `<installRoot>/agents/swt-{role}.md`.
   */
  readonly installRoot: string;
  /**
   * Optional task id — falls back to `spawn-${role}-${sessionId.slice(0,8)}`
   * when omitted. Surfaces in the result envelope so harvesters can match it.
   */
  readonly taskId?: string;
  /**
   * Optional session factory override — used by tests to inject a recording
   * mock and by Phase 4+ to swap in worktree-aware factories. Defaults to
   * `defaultSpawnSessionFactory` which delegates to runtime's `createSession`.
   */
  readonly sessionFactory?: SpawnAgentSessionFactory;
  /**
   * Plan 01-03 — explicit hook registrations override. When omitted,
   * spawnAgent looks for `<installRoot>/config/hooks.json` and loads from
   * disk; if THAT is also absent, the dispatcher runs with an empty
   * registration list (SubagentStart / SubagentStop events still fire but
   * have no handlers, which is the same shape as Phase 0). Tests inject
   * an empty array (or a tailored list) so the file system doesn't
   * matter for unit-level assertions.
   */
  readonly hookRegistrations?: ReadonlyArray<HookRegistration>;
  /**
   * Plan 01-03 — explicit hook event bus. Defaults to a silent no-op bus
   * — production callers pass `CliEventBus.emit` adapted into the
   * `HookEventBus` shape so hook log lines flow into
   * `.swt-planning/.events/{sessionId}.jsonl` alongside `agent.spawn` /
   * `agent.complete` (research §1.4: CliEventBus already supports
   * `log.append` entries).
   */
  readonly hookEventBus?: HookEventBus;
}

/**
 * Build the per-role session config used by spawnAgent's internal factory.
 * Exported for test assertions in `spawn-agent.test.ts` — tests can assert
 * on the resolved config without going through a session factory at all.
 */
export function resolveSpawnAgentConfig(
  opts: SpawnAgentOptions,
  injectedSink?: JournalSink,
): SpawnAgentSessionConfig {
  if (opts.role === 'orchestrator') {
    throw new Error(
      'spawnAgent: cannot spawn role "orchestrator" — the orchestrator is the caller, not a spawnable agent.',
    );
  }
  // Pi-native SDLC role narrowing (excludes 'orchestrator', includes 'docs'
  // after plan 01-01 T02's SDLCRole widening).
  const sdlcRole = opts.role;

  // Phase 02 (plan 02-01 T2) — switch from `readRolePrompt` (raw bytes) to
  // `readRolePromptWithMeta` so YAML frontmatter is stripped from the
  // LLM-visible body AND parsed `effort`/`maxTurns` populate the precedence
  // chain below. This is a deliberate behavioural change: pre-Phase-02 the
  // frontmatter (`name: swt-dev`, `permissionMode: acceptEdits`, etc.) was
  // visible in the model context; from Phase 02 forward, only the body
  // content reaches the model. The spawn-agent regression test asserts the
  // stripping invariant (`config.systemPrompt` no longer matches `^---` or
  // `^name:` patterns) AND that body content survives.
  const promptResult = readRolePromptWithMeta(
    resolve(opts.installRoot, 'agents'),
    `swt-${opts.role}.md`,
  );
  const systemPrompt = promptResult.body;
  const frontmatterMeta = promptResult.meta;

  // Phase G / Phase 1 / G-R1 — append the per-provider overlay if one
  // exists at `<installRoot>/provider_overlays/<role>-<provider>.md`.
  // No-op when `opts.provider` is undefined OR the overlay file is
  // absent (vendor-neutrality preservation per R4 — Anthropic/Google/
  // OpenRouter runs see no behavioral change). Separator is EXACTLY
  // `\n\n---\n\n` per R1 decision; the visible boundary preserves the
  // cache prefix invariance described in `prompt-builder.ts:88-91`.
  const overlay = readProviderOverlay(opts.installRoot, opts.role, opts.provider);
  const finalSystemPrompt =
    overlay !== undefined ? `${systemPrompt}\n\n---\n\n${overlay}` : systemPrompt;

  const tools = toolsForRole(sdlcRole, opts.cwd);

  // CRITICAL — orchestrator-only askUser invariant.
  // spawnAgent NEVER attaches `swt_ask_user` (or any other orchestrator-
  // exclusive tool) to a spawned role's tool list. The invariant is
  // enforced HERE in code (the customTools list below is empty save for
  // extension-provided tools), AND in plan 01-05's mechanical test
  // (Task A.6) which iterates AGENT_ROLES. See TDD3 §20.3 / §24. The
  // assertion in spawn-agent.test.ts ("askUser is not registered") is
  // the regression guard.
  //
  // Per-role custom tools are owned by the extensions[] factories below
  // — they register `swt_report_result` (via buildResultProtocolExtension)
  // but NOT askUser. The orchestrator session lives in a separate code
  // path: see `./spawn-orchestrator-session.ts` (plan 03-02 T2, R1). That
  // file is the ONLY place that wires `buildSwtAskUserExtension()`; the
  // guard at the top of `resolveSpawnAgentConfig` (role === 'orchestrator'
  // throws) keeps `spawnAgent` from accidentally taking over its job.
  const transcriptPath = resolve(
    opts.cwd,
    '.swt-planning',
    '.transcripts',
    `${opts.sessionId}.jsonl`,
  );

  const journalSink: JournalSink = injectedSink ?? new FileJournalSink(transcriptPath);

  const extensions: ReadonlyArray<SpawnAgentExtension> = [
    { name: 'resultProtocol', factory: buildResultProtocolExtension() },
    { name: 'journal', factory: buildJournalExtension({ sink: journalSink }) },
  ];

  // Phase 02 (plan 02-01 T2) — precedence: frontmatter > caller opts > role
  // default. The TDD §4 Phase 02 frontmatter table is now the authoritative
  // per-role turn budget AND reasoning depth; callers (tests, scripts) may
  // still override `maxTurns` via `opts.maxTurns`, but the frontmatter wins
  // when present. `DEFAULT_AGENT_MAX_TURNS` remains as a defensive fallback
  // for any agent file that lacks `maxTurns:` frontmatter (out-of-shape
  // greenfield agent file, partial migration).
  //
  // For `thinkingLevel`, there is no caller-level override field today, so
  // the precedence collapses to frontmatter > `resolveThinkingLevelForRole`.
  // The role-resolver default is left intact (TDD §4 Phase 02 Recommendation
  // 6 — per-role defaults belong in agent frontmatter OR
  // `DEFAULT_ROLE_THINKING_LEVELS`, never `quirks.json`).
  const maxTurns = frontmatterMeta.maxTurns ?? opts.maxTurns ?? DEFAULT_AGENT_MAX_TURNS[opts.role];
  const thinkingLevel = frontmatterMeta.effort ?? resolveThinkingLevelForRole(sdlcRole);
  const sandboxMode = defaultSandboxModeForRole(opts.role);

  const taskId = opts.taskId ?? `spawn-${opts.role}-${opts.sessionId.slice(0, 8)}`;

  return {
    role: opts.role,
    cwd: opts.cwd,
    ephemeral: true,
    enableResultProtocol: true,
    taskId,
    // Phase 2 — `provider`/`model`/`resolvedCredential` are copied straight
    // from `opts` onto the resolved config (the fields are optional on
    // `SwtSessionOptions`, which `SpawnAgentSessionConfig` extends). `provider`
    // ALSO still feeds `readProviderOverlay` above — the overlay code path is
    // unchanged; `provider` now does double duty (overlay key + credential-
    // injection provider id).
    provider: opts.provider,
    model: opts.model,
    resolvedCredential: opts.resolvedCredential,
    systemPrompt: finalSystemPrompt,
    tools,
    extensions,
    transcriptPath,
    maxTurns,
    thinkingLevel,
    sandboxMode,
  };
}

/**
 * Spawn a role-bound Pi session and dispatch a task on it.
 *
 * Returns the harvested `TaskResult`. The dispatcher's default
 * `harvestStrategy: 'stub'` returns a synthetic success — real harvest wiring
 * lands when the runtime session-wiring follow-up replaces the mock
 * `prompt()` body. The contract (TaskResult envelope shape, role-aware
 * tools, transcript path, askUser exclusion) is testable today via the
 * recording session factory injected by `spawn-agent.test.ts`.
 */
export async function spawnAgent(opts: SpawnAgentOptions): Promise<TaskResult> {
  const config = resolveSpawnAgentConfig(opts);
  const factory = opts.sessionFactory ?? defaultSpawnSessionFactory;

  // Plan 01-03 — construct the HookDispatcher per spawn. Registrations
  // come from (in order): explicit opts, `<installRoot>/config/hooks.json`
  // on disk, or an empty list (no-op dispatcher; SubagentStart/Stop still
  // fire to the event bus, just match no handlers).
  const hookRegistrations = resolveHookRegistrations(opts);
  const hookDispatcher: HookDispatcher = createHookDispatcher({
    registrations: hookRegistrations,
    installRoot: opts.installRoot,
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    ...(opts.hookEventBus !== undefined ? { eventBus: opts.hookEventBus } : {}),
    role: opts.role,
  });

  // The dispatcher's SessionFactory accepts SwtSessionOptions. spawnAgent's
  // SpawnAgentSessionConfig extends SwtSessionOptions, so the closure below
  // is a structural specialisation: it ignores the per-task opts the
  // dispatcher would otherwise pass (cwd, taskId, etc.) and uses the
  // pre-resolved spawn config instead. Per-task meter context is still
  // honoured (the dispatcher overrides task_id on meterContext).
  //
  // Plan 01-03 — the factory also calls `hookDispatcher.subscribeToSession`
  // on the freshly-created session and wraps `dispose()` so the
  // unsubscribe runs before the underlying dispose. This guarantees no
  // dispatcher leak when a session is disposed (whether normally or by
  // exception).
  const sessionFactory: SessionFactory = async (dispatcherOpts) => {
    const session = await factory({
      ...config,
      // Honour the dispatcher's per-task meter context override (it
      // injects task_id matching the brief's taskId).
      ...(dispatcherOpts.meter !== undefined ? { meter: dispatcherOpts.meter } : {}),
      ...(dispatcherOpts.meterContext !== undefined
        ? { meterContext: dispatcherOpts.meterContext }
        : {}),
    });
    const unsubscribe = hookDispatcher.subscribeToSession(session);
    const originalDispose = session.dispose.bind(session);
    return {
      sessionId: session.sessionId,
      prompt: session.prompt.bind(session),
      subscribe: session.subscribe.bind(session),
      dispose: () => {
        try {
          unsubscribe();
        } finally {
          originalDispose();
        }
      },
    };
  };

  const dispatcher = createDispatcher({ sessionFactory });
  const brief: TaskBrief = {
    taskId: config.taskId ?? `spawn-${opts.role}`,
    role: opts.role,
    cwd: opts.cwd,
    promptContext: {
      role: opts.role,
      cwd: opts.cwd,
      prompt: opts.prompt,
      sessionId: opts.sessionId,
      installRoot: opts.installRoot,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      maxTurns: config.maxTurns,
    },
  };

  // Plan 01-03 — fire SubagentStart BEFORE dispatch. The event is
  // informational; even if no handler is registered the bus records a
  // 'noop' marker. Always-await: a SubagentStart hook that takes 4s is
  // intentional — it's a synchronization point.
  await hookDispatcher.dispatchSessionEvent('SubagentStart', {
    role: opts.role,
    toolName: undefined,
  });

  // The dispatcher.dispatch() call below creates the Pi session via our
  // wrapped factory; the wrapper subscribes the HookDispatcher to the
  // session for the duration. SubagentStop fires after dispatch returns
  // (whether success OR failure) so the lifecycle pairs cleanly.
  let result: TaskResult;
  try {
    result = await dispatcher.dispatch(brief);
  } finally {
    await hookDispatcher.dispatchSessionEvent('SubagentStop', {
      role: opts.role,
      toolName: undefined,
    });
  }
  return result;
}

/**
 * Resolve the hook registrations for a single spawnAgent call. Explicit
 * opts win; failing that, look for `<installRoot>/config/hooks.json`;
 * failing that, return an empty list.
 *
 * Catching the readFileSync error keeps the spawn path resilient: a
 * hooks.json typo MUST NOT crash the entire orchestrator. The bash
 * scripts themselves are still discovered + dispatched at runtime; a
 * broken hooks.json simply means SubagentStart/Stop become no-ops.
 */
function resolveHookRegistrations(opts: SpawnAgentOptions): ReadonlyArray<HookRegistration> {
  if (opts.hookRegistrations !== undefined) return opts.hookRegistrations;
  const configPath = resolve(opts.installRoot, 'config', 'hooks.json');
  if (!existsSync(configPath)) return [];
  try {
    return loadHookRegistrationsFromConfig(configPath);
  } catch (err) {
    // Surface the parse error on stderr (deterministic; tests can match)
    // but do NOT throw — the hook-wrapper invariant extends to config
    // resolution. A malformed config disables hooks; it does not crash
    // the spawn.
    process.stderr.write(
      `spawnAgent: failed to load ${configPath}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return [];
  }
}
