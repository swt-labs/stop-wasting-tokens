/**
 * `swt:spawnOrchestratorSession` — Plan 03-02 (Phase 3) Task 2.
 *
 * The ORCHESTRATOR-side companion to `spawnAgent`. Whereas `spawnAgent`
 * spawns a role-bound subagent Pi session (dev / qa / scout / lead /
 * debugger / docs) and explicitly REFUSES to construct an orchestrator
 * session (see `spawn-agent.ts` line 312 — the guard is preserved on
 * purpose), THIS function is the dedicated code path that builds an
 * orchestrator Pi session.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Architect decision R1 (resolved in Plan 03-02 Lead pass)
 * ────────────────────────────────────────────────────────────────────────────
 * The orchestrator role is NOT spawnable through `spawnAgent` — that would
 * break the orchestrator-only `swt_ask_user` invariant by routing the
 * construction through the same code path that intentionally excludes the
 * tool from every other role's registry.
 *
 * Instead, `spawnOrchestratorSession`:
 *   - explicitly sets `role: 'orchestrator'`
 *   - registers `buildSwtAskUserExtension()` in extensions[] BEFORE the
 *     Result Protocol + Journal extensions (so the orchestrator session
 *     has access to the askUser bridge from the first turn)
 *   - uses the standard coding tool bundle (Read/Write/Edit/Bash/Glob/Grep/
 *     LSP/TodoWrite via createCodingTools), so the orchestrator can do
 *     everything an LLM session can do
 *   - reuses the same Pi-session lifecycle wiring as `spawnAgent` —
 *     HookDispatcher, SubagentStart/SubagentStop events, transcript
 *     journaling at `.swt-planning/.transcripts/{sessionId}.jsonl`,
 *     `defaultSpawnSessionFactory` (so tests can inject a recording
 *     factory)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * System prompt sourcing
 * ────────────────────────────────────────────────────────────────────────────
 * `agents/swt-orchestrator.md` does not currently exist in the repo (the
 * orchestrator's role prompt is the body of `commands/cook.md`, post-
 * frontmatter-strip). The caller (`cookHandler` in
 * `packages/cli/src/commands/cook.ts`) is responsible for assembling the
 * orchestrator's system + first-user prompt from cook.md's mode sections;
 * spawnOrchestratorSession receives the assembled `prompt` and uses it as
 * the session's initial user prompt. The session's `systemPrompt` field is
 * the prompt body itself — Pi 0.74 has no `systemPrompt` input option (see
 * the spawn-agent.ts head comment), so we record it on the config for the
 * dispatcher to prepend at prompt-time once real Pi wiring lands.
 *
 * This mirrors the existing `spawnAgent` pattern verbatim except for:
 *   (a) the role
 *   (b) the additional `swt_ask_user` extension factory
 *   (c) sourcing the system prompt from `opts.prompt` instead of reading
 *       `agents/swt-{role}.md` from disk
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildJournalExtension,
  buildResultProtocolExtension,
  buildSwtAskUserExtension,
  buildSwtCompleteScopeSeedExtension,
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
import { createCodingTools } from '@swt-labs/runtime';
import type { AuthMode, TaskBrief, TaskResult } from '@swt-labs/shared';

import { createDispatcher, type SessionFactory } from './dispatcher.js';
import { getProviderTuningPack } from './packs/registry.js';
import type { AgentToolList } from './role-router.js';

/**
 * Default max turns for the orchestrator. Mirrors the value in
 * `spawn-agent.ts`'s DEFAULT_AGENT_MAX_TURNS map but is duplicated here so
 * the orchestrator code path does not import the non-public constant.
 */
const DEFAULT_ORCHESTRATOR_MAX_TURNS = 100;

/**
 * Resolved per-spawn session configuration for the orchestrator. Structurally
 * a strict superset of `SwtSessionOptions` — same shape as
 * `SpawnAgentSessionConfig` from `spawn-agent.ts`, with `role` pinned to
 * `'orchestrator'`.
 */
export interface SpawnOrchestratorSessionConfig extends SwtSessionOptions {
  readonly systemPrompt: string;
  readonly tools: AgentToolList;
  readonly extensions: ReadonlyArray<OrchestratorExtension>;
  readonly transcriptPath: string;
  readonly maxTurns: number;
  readonly thinkingLevel: ThinkingLevel;
  readonly sandboxMode: 'workspace-write';
  readonly role: 'orchestrator';
}

export interface OrchestratorExtension {
  /** Human-readable name for test assertions / debugging. */
  readonly name: 'swtAskUser' | 'swtCompleteScopeSeed' | 'resultProtocol' | 'journal';
  /** Pi extension factory — invoked once at session start with `PiExtensionAPI`. */
  readonly factory: (pi: PiExtensionAPI) => void;
}

/** Factory used internally to create the per-orchestrator-session Pi session. */
export type SpawnOrchestratorSessionFactory = (
  config: SpawnOrchestratorSessionConfig,
) => Promise<SwtSession>;

/**
 * Default factory — forwards to the runtime's `createSession` and drops
 * orchestrator-specific fields. The runtime records them structurally
 * (consistent with `enableResultProtocol`'s precedent) and activates them
 * when the Pi session-wiring follow-up lands. Mirrors `spawn-agent.ts`'s
 * `defaultSpawnSessionFactory` 1:1.
 */
const defaultOrchestratorSessionFactory: SpawnOrchestratorSessionFactory = async (config) => {
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
    // This is the load-bearing link: it carries the resolved credential into
    // `createSession`'s in-memory AuthStorage-injection branch (02-02).
    ...(config.provider !== undefined ? { provider: config.provider } : {}),
    ...(config.model !== undefined ? { model: config.model } : {}),
    ...(config.resolvedCredential !== undefined
      ? { resolvedCredential: config.resolvedCredential }
      : {}),
    // Phase 03 plan 03-01 T3 — forward resolved extension factories to
    // `createSession`, which materializes them into Pi's `customTools[]`.
    // Symmetric with `defaultSpawnSessionFactory` in spawn-agent.ts. The
    // SwtSessionOptions boundary uses the disambiguated name
    // `extensionFactories`; this config's `extensions` slot is the
    // named-extension introspection list.
    ...(config.extensions !== undefined && config.extensions.length > 0
      ? { extensionFactories: config.extensions.map((e) => e.factory) }
      : {}),
  };
  return createSession(sessionOpts);
};

/**
 * Options for `spawnOrchestratorSession`. Same runtime-context fields as
 * `SpawnAgentOptions` except `role` is implicit (always `'orchestrator'`)
 * and `prompt` is the assembled orchestrator system+first-user prompt (the
 * caller — `cookHandler` — does the cook.md mode-section extraction + the
 * `${SWT_INSTALL_ROOT}` / `${SWT_PHASE_DETECT_OUTPUT}` placeholder
 * substitution).
 */
export interface SpawnOrchestratorSessionOptions {
  readonly prompt: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly installRoot: string;
  readonly maxTurns?: number;
  /**
   * Optional provider id (e.g., `'openai'`, `'anthropic'`,
   * `'openrouter/anthropic/claude-...'`). When supplied AND
   * `<installRoot>/provider_overlays/orchestrator-<provider>.md` exists,
   * its body is appended to the resolved orchestrator system prompt with
   * `\n\n---\n\n` separator (R1 — methodology contract first, overlay
   * is execution-style refinement). When `undefined` or when no overlay
   * file exists, behavior is byte-identical to pre-Phase-1 (R4 vendor-
   * neutrality preservation). G-R1 symmetric wiring — Phase 1 does NOT
   * author the orchestrator overlay file; the plumbing is symmetric so
   * future phases can drop in `orchestrator-<provider>.md` without code
   * change.
   *
   * Phase 2 — `provider` is now ALSO the provider id the resolved
   * credential is `.set()` for in `createSession`'s AuthStorage injection,
   * not only the overlay-prompt key.
   */
  readonly provider?: string;
  /**
   * Phase 2 (Selection → Spawn Wiring) — the keychain-resolved credential
   * for `provider`, supplied by the cook spawn callsite (Phase 2 plan 02-04
   * via Phase 1's `resolveCredentialStore`). Same shape as
   * `SwtSessionOptions.resolvedCredential`. `secret` is a SECRET — never log
   * it, never serialize it. Forwarded to `createSession`, which injects it
   * into Pi's in-memory AuthStorage. When `undefined`, the spawn is
   * byte-identical to pre-Phase-2.
   */
  readonly resolvedCredential?: {
    readonly authMode: AuthMode;
    readonly secret: string;
  };
  /**
   * Phase 2 — OPTIONAL model-id override. Risk 8: Phase 2 never sets this;
   * it stays `undefined` so Pi's ModelRegistry resolves the provider default.
   * Threaded purely so the model-picker fast-follow needs no contract change.
   */
  readonly model?: string;
  readonly taskId?: string;
  readonly sessionFactory?: SpawnOrchestratorSessionFactory;
  readonly hookRegistrations?: ReadonlyArray<HookRegistration>;
  readonly hookEventBus?: HookEventBus;
  /**
   * Test seam — override the askUser implementation embedded in the
   * `swt_ask_user` extension. Production callers omit; tests inject a
   * deterministic fake so the orchestrator's confirmation gates can be
   * exercised without a TTY / dashboard.
   */
  readonly askUserImpl?: Parameters<typeof buildSwtAskUserExtension>[0] extends infer O
    ? O extends { askUserImpl?: infer F }
      ? F
      : never
    : never;
  /**
   * alpha.23 — pluggable trace sink for LLM assistant text + tool calls.
   * Defaults to `process.stderr.write` so the cook subprocess's stderr
   * carries the LLM's actual responses + tool-call activity onto
   * `cook-start.ts`'s `log.append` event channel → dashboard Log panel.
   * Tests inject a recorder; setting `null` disables tracing entirely.
   *
   * Closes the visibility gap where users could spend tokens (cook.
   * provider_selected + cook.agent_result fire) without ever seeing the
   * LLM's actual response text in the dashboard — the dispatcher counts
   * tokens but never surfaces prose.
   */
  readonly traceWriter?: ((line: string) => void) | null;
}

/**
 * Build the orchestrator session config. Exported for test assertions —
 * tests can verify the resolved tool list, extensions, and prompt without
 * spinning up a real Pi session.
 */
export function resolveOrchestratorSessionConfig(
  opts: SpawnOrchestratorSessionOptions,
  injectedSink?: JournalSink,
): SpawnOrchestratorSessionConfig {
  // The orchestrator gets the full coding bundle so it can do everything
  // a non-orchestrator role can (Read/Write/Edit/Bash/Glob/Grep/LSP/TodoWrite).
  const tools = createCodingTools(opts.cwd);

  const transcriptPath = resolve(
    opts.cwd,
    '.swt-planning',
    '.transcripts',
    `${opts.sessionId}.jsonl`,
  );

  const journalSink: JournalSink = injectedSink ?? new FileJournalSink(transcriptPath);

  // R2 — the swt_ask_user extension MUST come FIRST so the tool is registered
  // before the Result Protocol / Journal extensions run their setup. The
  // ordering matters because Pi's `registerTool` is synchronous within the
  // factory call — earlier registrations win if names ever collided.
  //
  // Phase 02 / Plan 02-01 — swt_complete_scope_seed is registered
  // immediately after swt_ask_user, preserving the "user-facing tools
  // first, infrastructure tools after" ordering intent. Both are
  // orchestrator-only by ADR-002.
  const extensions: ReadonlyArray<OrchestratorExtension> = [
    {
      name: 'swtAskUser',
      factory: buildSwtAskUserExtension(
        opts.askUserImpl !== undefined ? { askUserImpl: opts.askUserImpl } : {},
      ),
    },
    {
      name: 'swtCompleteScopeSeed',
      factory: buildSwtCompleteScopeSeedExtension({ projectRoot: opts.cwd }),
    },
    { name: 'resultProtocol', factory: buildResultProtocolExtension() },
    { name: 'journal', factory: buildJournalExtension({ sink: journalSink }) },
  ];

  const maxTurns = opts.maxTurns ?? DEFAULT_ORCHESTRATOR_MAX_TURNS;
  const thinkingLevel = resolveThinkingLevelForRole('lead');
  // The orchestrator always writes — confirmation gates trigger `swt cook`'s
  // mutation paths (plan creation, phase mutation, archive, …). 'workspace-write'
  // is the only valid sandbox mode.
  const sandboxMode = 'workspace-write' as const;

  const taskId = opts.taskId ?? `orchestrator-${opts.sessionId.slice(0, 8)}`;

  // Phase 17 plan 01-01 T4 — provider-specific decisions for the
  // orchestrator path also flow through the pack registry. The orchestrator
  // queries `pack.resolveOverlay('orchestrator')` with a hardcoded role key
  // (Scout's surprise #5 — no `agents/swt-orchestrator.md` file exists;
  // the orchestrator's prompt is the body of `commands/cook.md`). The
  // orchestrator path does NOT call `pack.customExtensions()` — the
  // orchestrator's 4-entry extensions list ([swtAskUser,
  // swtCompleteScopeSeed, resultProtocol, journal]) is fixed by design,
  // and the orchestrator never receives apply_patch (it is not in
  // APPLY_PATCH_ELIGIBLE_ROLES even if some future pack tried to return
  // it).
  const pack = getProviderTuningPack(opts.provider, opts.installRoot);
  const overlay = pack.resolveOverlay('orchestrator');
  const finalSystemPrompt =
    overlay !== undefined ? `${opts.prompt}\n\n---\n\n${overlay}` : opts.prompt;

  return {
    role: 'orchestrator' as const,
    cwd: opts.cwd,
    ephemeral: true,
    enableResultProtocol: true,
    taskId,
    // Phase 2 — `provider`/`model`/`resolvedCredential` are copied straight
    // from `opts` onto the resolved config (the fields are optional on
    // `SwtSessionOptions`, which `SpawnOrchestratorSessionConfig` extends).
    // `provider` ALSO still feeds `readProviderOverlay` above — the overlay
    // code path is unchanged; `provider` now does double duty.
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
 * Spawn the orchestrator Pi session and dispatch the cook.md mode body as
 * its initial user prompt.
 *
 * Returns the harvested `TaskResult` (mirroring `spawnAgent`'s return type).
 * The dispatcher's default `harvestStrategy: 'stub'` returns a synthetic
 * success — real harvest wiring lands when the runtime session-wiring
 * follow-up replaces the mock prompt body.
 */
export async function spawnOrchestratorSession(
  opts: SpawnOrchestratorSessionOptions,
): Promise<TaskResult> {
  const config = resolveOrchestratorSessionConfig(opts);
  const factory = opts.sessionFactory ?? defaultOrchestratorSessionFactory;

  const hookRegistrations = resolveOrchestratorHookRegistrations(opts);
  const hookDispatcher: HookDispatcher = createHookDispatcher({
    registrations: hookRegistrations,
    installRoot: opts.installRoot,
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    ...(opts.hookEventBus !== undefined ? { eventBus: opts.hookEventBus } : {}),
    role: 'orchestrator',
  });

  // alpha.23 — default trace sink: write to the cook subprocess's stderr,
  // which cook-start.ts captures and forwards onto `log.append` events for
  // the dashboard Log panel. Setting `traceWriter: null` disables tracing
  // (used by tests to avoid stderr noise). Default is suppressed when
  // SWT_NO_LLM_TRACE=1 (vitest env can opt out without per-test wiring).
  const defaultTrace = (line: string): void => {
    if (process.env['SWT_NO_LLM_TRACE'] === '1') return;
    process.stderr.write(line);
  };
  const traceWriter: ((line: string) => void) | null =
    opts.traceWriter === undefined ? defaultTrace : opts.traceWriter;

  // Wrap the user-supplied factory so the dispatcher's per-task meter
  // context still propagates. Mirrors `spawn-agent.ts` 1:1.
  const sessionFactory: SessionFactory = async (dispatcherOpts) => {
    const session = await factory({
      ...config,
      ...(dispatcherOpts.meter !== undefined ? { meter: dispatcherOpts.meter } : {}),
      ...(dispatcherOpts.meterContext !== undefined
        ? { meterContext: dispatcherOpts.meterContext }
        : {}),
    });
    const unsubscribe = hookDispatcher.subscribeToSession(session);

    // alpha.23 — LLM visibility trace. Accumulate MESSAGE_DELTA text per
    // turn; flush a single readable `[llm turn N] …` line on turn-end
    // (which mapPiEvent surfaces as TASK_TOKEN_USAGE or TASK_ERROR).
    // TOOL_CALL events fire inline as `[tool] toolName` so the user can
    // watch the orchestrator's Read/Glob/Bash activity in real time.
    // Truncation cap (2000 chars) keeps a chatty turn from flooding the
    // Log panel — full text stays in Pi's session history regardless.
    //
    // Closes the gap surfaced in user testing: dashboard shows tokens
    // spent + agent_spawn/agent_result but ZERO assistant prose, making
    // it impossible to follow what the LLM is actually saying or doing.
    let messageBuffer = '';
    let turnIndex = 0;
    const TRUNCATE_AT = 2000;
    const flushMessage = (): void => {
      if (traceWriter === null || messageBuffer.length === 0) return;
      turnIndex += 1;
      const truncated =
        messageBuffer.length > TRUNCATE_AT
          ? `${messageBuffer.slice(0, TRUNCATE_AT)}…[truncated, ${messageBuffer.length - TRUNCATE_AT} more chars]`
          : messageBuffer;
      traceWriter(`[llm turn ${turnIndex}] ${truncated}\n`);
      messageBuffer = '';
    };
    const unsubscribeTrace =
      traceWriter !== null
        ? session.subscribe((event) => {
            try {
              if (event.type === 'MESSAGE_DELTA') {
                messageBuffer += event.text;
              } else if (event.type === 'TASK_TOKEN_USAGE' || event.type === 'TASK_ERROR') {
                flushMessage();
              } else if (event.type === 'TOOL_CALL') {
                // Flush any pending message text BEFORE the tool-call
                // line so the chronological order reads correctly: LLM
                // said X, then called tool Y.
                flushMessage();
                traceWriter(`[tool] ${event.name}\n`);
              }
            } catch {
              // Trace must never crash the session — best-effort. A
              // misbehaving writer (e.g., stderr pipe closed) silently
              // degrades to "no trace" rather than killing the orchestrator.
            }
          })
        : (): void => {
            /* no-op when tracing disabled */
          };

    const originalDispose = session.dispose.bind(session);
    return {
      sessionId: session.sessionId,
      prompt: session.prompt.bind(session),
      subscribe: session.subscribe.bind(session),
      dispose: () => {
        try {
          // alpha.23 — flush any tail message text that didn't get a
          // terminating turn_end (rare; e.g., session disposed mid-turn).
          flushMessage();
        } finally {
          try {
            unsubscribe();
            unsubscribeTrace();
          } finally {
            originalDispose();
          }
        }
      },
    };
  };

  const dispatcher = createDispatcher({ sessionFactory });
  const brief: TaskBrief = {
    taskId: config.taskId ?? `orchestrator-${opts.sessionId.slice(0, 8)}`,
    role: 'orchestrator',
    cwd: opts.cwd,
    promptContext: {
      role: 'orchestrator',
      cwd: opts.cwd,
      prompt: opts.prompt,
      sessionId: opts.sessionId,
      installRoot: opts.installRoot,
      maxTurns: config.maxTurns,
    },
  };

  await hookDispatcher.dispatchSessionEvent('SubagentStart', {
    role: 'orchestrator',
    toolName: undefined,
  });

  let result: TaskResult;
  try {
    result = await dispatcher.dispatch(brief);
  } finally {
    await hookDispatcher.dispatchSessionEvent('SubagentStop', {
      role: 'orchestrator',
      toolName: undefined,
    });
  }
  return result;
}

/**
 * Resolve the hook registrations for an orchestrator spawn. Explicit opts
 * win; failing that, look for `<installRoot>/config/hooks.json`; failing
 * that, return an empty list. Mirrors `spawn-agent.ts`'s
 * `resolveHookRegistrations` 1:1.
 */
function resolveOrchestratorHookRegistrations(
  opts: SpawnOrchestratorSessionOptions,
): ReadonlyArray<HookRegistration> {
  if (opts.hookRegistrations !== undefined) return opts.hookRegistrations;
  const configPath = resolve(opts.installRoot, 'config', 'hooks.json');
  if (!existsSync(configPath)) return [];
  try {
    return loadHookRegistrationsFromConfig(configPath);
  } catch (err) {
    process.stderr.write(
      `spawnOrchestratorSession: failed to load ${configPath}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return [];
  }
}
