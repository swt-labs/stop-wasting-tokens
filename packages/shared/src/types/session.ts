import type { TokenMeter } from './meter.js';
import type { ThinkingLevel } from './thinking-level.js';

/**
 * Credential kind. MUST stay byte-identical to `@swt-labs/runtime`'s
 * `credentials/types.ts` `AuthMode` — `shared` (L0) cannot import `runtime`
 * (L2) without an upward-cycle layering violation, so this is a deliberate
 * local mirror. Phase 2 (Selection → Spawn Wiring) / Risk 8.
 */
export type AuthMode = 'api_key' | 'oauth';

/**
 * SWT session — vendor-neutral wrapper over Pi's `AgentSession`.
 *
 * Migrated from `runtime/src/types.ts` in PR-04. The shape is locked in here
 * so methodology / orchestration / dashboard can reason about sessions
 * without importing `@earendil-works/pi-coding-agent` (Principle 1 §4.3).
 *
 * Concrete implementation lives in `runtime/src/session.ts`. PR-06 swaps the
 * stub body for a real `createAgentSession()` call.
 */
export interface SwtSession {
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: SwtEvent) => void): () => void;
  readonly sessionId: string;
  dispose(): void;
}

/**
 * Per-session meter dimensions. The dispatcher knows these (it builds the
 * TaskBrief) and passes them into the session at construction so each
 * `MeterRecord` row carries the correct task / phase / milestone / role /
 * tier tags without the session having to know about the dispatcher.
 */
export interface MeterContext {
  readonly milestone?: string;
  readonly phase?: string;
  readonly task_id?: string;
  readonly role?: string;
  readonly tier?: string;
}

/**
 * Construction-time options for `createSession`. The meter is constructor-
 * injected (not attached via a post-construction method) — locked in at
 * Plan 01-01 PR-04 review.
 */
export interface SwtSessionOptions {
  readonly cwd: string;
  readonly ephemeral?: boolean;
  readonly meter?: TokenMeter;
  readonly meterContext?: MeterContext;
  /**
   * When `true`, the runtime registers the `swt_report_result` Pi
   * Extension on the session before the first `prompt()` per ADR-002.
   * Required for any dispatched-agent flow that produces a
   * `TaskResult` envelope (every Dev / QA / Lead task today).
   *
   * **M3 PR-26 ship state — recorded but no-op.** The runtime mock's
   * `createSession` simply records the flag; the real Pi adapter
   * (deferred session-wiring follow-up before Plan 03-02 begins)
   * threads `buildResultProtocolExtension()` into Pi's
   * `createAgentSession({ extensions: [...] })` call.
   */
  readonly enableResultProtocol?: boolean;
  /**
   * Task ID — needed by the `swt_report_result` extension to label
   * the persisted result envelope. The dispatcher writes this into a
   * `task-context` session entry before the first prompt; the runtime
   * threads it through `meterContext.task_id` already, but the
   * dedicated field lets the result protocol read it without taking a
   * meterContext dependency.
   *
   * **M3 PR-26 ship state — recorded but no-op.** Wired through to
   * Pi's session entry by the session-wiring follow-up.
   */
  readonly taskId?: string;
  /**
   * Phase 2 (Selection → Spawn Wiring) — the resolved provider id this
   * session runs on (e.g. `'openai'`, `'anthropic'`). When set, the real
   * `createSession` injects the credential for this provider into Pi's
   * `AuthStorage`. When `undefined`, `createSession` is byte-identical to
   * pre-Phase-2 (Pi falls through to its own `auth.json` + env-var
   * resolution). Resolved by the cook spawn callsite (Phase 2 plan 02-04).
   *
   * Risk 5: this field is OPTIONAL — every existing `SwtSessionOptions`
   * construction (incl. `createMockSession`, the recording factory, every
   * cassette/parity fixture) compiles + behaves unchanged when it is absent.
   */
  readonly provider?: string;
  /**
   * Phase 2 — OPTIONAL model-id override. Risk 8: Phase 2 NEVER sets this —
   * it stays `undefined` for every Phase 2 path so Pi's `ModelRegistry` +
   * `model-resolver.ts` resolves the chosen provider's default model. The
   * field exists purely so the documented model-picker fast-follow can
   * populate it without a contract change. Note: this is a model-id
   * *string*; Pi's `createAgentSession` takes a resolved `Model<any>` — the
   * fast-follow that populates this field also owns the id → `Model`
   * resolution. Phase 2's `createSession` never forwards it to Pi.
   */
  readonly model?: string;
  /**
   * Phase 2 — the already-resolved credential the cook callsite pulled from
   * the OS keychain (Phase 2 plan 02-04, via Phase 1's
   * `resolveCredentialStore`). `secret` is an API-key string in Phase 2; a
   * serialized `OAuthCredentials` JSON blob in Phase 4.
   *
   * SECURITY — this field carries a SECRET. It MUST NEVER be logged, NEVER
   * serialized into transcripts / events JSONL, NEVER written to disk. It is
   * consumed ONLY by the real `createSession`'s in-memory `AuthStorage`
   * injection (RAM-only, via `InMemoryAuthStorageBackend`) and then dropped.
   * The mock path `void`s it.
   *
   * Risk 5: OPTIONAL — absent ⇒ `createSession` is byte-identical to
   * pre-Phase-2.
   */
  readonly resolvedCredential?: {
    readonly authMode: AuthMode;
    readonly secret: string;
  };
  /**
   * Pi-native thinking level — forwarded to `createAgentSession({thinkingLevel})`
   * on Pi 0.74 (sdk.d.ts:23). Resolved by `resolveThinkingLevelForRole` or
   * overridden by agent frontmatter (Phase 02, plan 02-01). Closes the silent-
   * drop bug where `SpawnAgentSessionConfig.thinkingLevel` was resolved but
   * dropped at `defaultSpawnSessionFactory` before reaching `createSession`.
   * The mock path `void`s it.
   */
  readonly thinkingLevel?: ThinkingLevel;
  /**
   * Phase 03 remediation R01 — SWT-layer system-prompt body (role prompt +
   * provider overlay, already concatenated by `resolveSpawnAgentConfig` at
   * the orchestration layer). When present, `runtime/src/session.ts` threads
   * this into Pi's `DefaultResourceLoader({systemPrompt})` so Pi's
   * `AgentSession._rebuildSystemPrompt` uses it as `customPrompt` in
   * `buildSystemPrompt` — making the role prompt model-visible at
   * session-start. Pi 0.74 has no top-level `systemPrompt` option on
   * `createAgentSession`; the `resourceLoader` is the canonical seam.
   *
   * Closes GATE-07 / GATE-15 from 03-VERIFICATION.md — pre-R01 the field
   * existed on `SpawnAgentSessionConfig` but the runtime adapter stripped
   * it (the "recorded but not injected" hole).
   */
  readonly systemPrompt?: string;
  /**
   * Phase 03 remediation R01 — SWT-layer pack-resolved context-file
   * fragments (e.g. AGENTS.md content from `CodexViaOverlayPack`'s
   * `loadAgentsMd` walk-up). Whole-file content strings — NO paths
   * (matches the Phase 1 `ContextFilesTurnContext.contextFiles` shape at
   * provider-tuning-pack.ts:121). When present, `runtime/src/session.ts`
   * reshapes each element into Pi's `{path: 'AGENTS.md#<idx>', content}`
   * shape and threads it through
   * `DefaultResourceLoader({agentsFilesOverride})` so Pi's
   * `_rebuildSystemPrompt` picks them up as `contextFiles` in
   * `buildSystemPrompt` — making the AGENTS.md content model-visible at
   * session-start. Pi's own AGENTS.md walk-up is disabled via
   * `noContextFiles: true` to avoid double-loading (SWT's pack already
   * loaded them).
   */
  readonly contextFiles?: readonly string[];
  /**
   * Phase 03 plan 03-01 T3 — Pi extension factories to register on the
   * agent session at construction. Each factory is invoked once with a
   * recording `PiExtensionAPI` shim; the captured `registerTool` calls
   * become `customTools[]` on Pi's `createAgentSession`. Closes the
   * deferred-state hole called out in Scout Phase 03 risk #1
   * (the orchestrator-session path threads `extensions` on the resolved
   * config but the runtime adapter had never materialized them — same
   * story for the agent path until now).
   *
   * Shape is structural: `(pi: any) => void`. The runtime narrows
   * `any` to its locally-typed `PiExtensionAPI` at the call boundary —
   * shared/ (L0) cannot import runtime/extensions/pi-types.ts (L2) without
   * an upward-cycle layering violation. Tests and orchestration use the
   * proper `PiExtensionAPI` shape and assign here via structural
   * compatibility.
   *
   * Field name is `extensionFactories` (not `extensions`) to avoid
   * colliding with `SpawnAgentSessionConfig.extensions` /
   * `SpawnOrchestratorSessionConfig.extensions`, both of which already
   * existed as `ReadonlyArray<{name, factory}>` named-extension lists
   * for test introspection. The orchestration layer maps those into bare
   * factory functions before forwarding here.
   *
   * Risk: OPTIONAL — absent (or empty array) ⇒ `createSession` is
   * byte-identical to pre-Phase-03 (`customTools` not set, Pi falls
   * through to its built-in tools only).
   */
  readonly extensionFactories?: ReadonlyArray<SessionExtensionFactory>;
}

/**
 * Structural shape of a Pi extension factory at the `SwtSessionOptions`
 * boundary. The factory body calls `pi.registerTool({...})` (and possibly
 * `pi.on(...)` / `pi.appendEntry(...)`); the runtime adapter materializes
 * the captured registrations into Pi's `customTools[]` at
 * `createAgentSession` time.
 *
 * The parameter is typed `any` (not `unknown`) so concrete
 * `(pi: PiExtensionAPI) => void` factories from `runtime/extensions/`
 * remain assignable here without an explicit cast at every assignment
 * site. Function parameters are contravariant — a factory expecting a
 * narrower `PiExtensionAPI` cannot satisfy a `(pi: unknown) => void`
 * signature, but `any` opts out of variance checking and lets the
 * concrete shape flow through. The runtime knows the actual shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SessionExtensionFactory = (pi: any) => void;

/**
 * Per-turn token usage extracted from a Pi `turn_end` event. Lives on
 * `SwtEvent.TASK_TOKEN_USAGE`; the runtime's meter consumes these to
 * populate `MeterRecord` rows.
 *
 * Fields are aligned to the union of Anthropic + OpenAI usage shapes so
 * extractor adapters in `runtime/src/providers/extractors/<provider>.ts`
 * can map their native fields into a single neutral shape. Cache fields
 * default to 0 when a provider doesn't report them.
 */
export interface TaskTokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly turn: number;
  readonly provider: string;
  readonly model: string;
}

/**
 * Vendor-neutral event union. Pi's 14 raw events get mapped into this in
 * `runtime/src/events.ts`. PR-07 added `TASK_TOKEN_USAGE` (Pi `turn_end`).
 * alpha.21 added `TASK_ERROR` for the `turn_end + stopReason='error'` case
 * — Pi keeps the API failure on the message envelope (`errorMessage`) rather
 * than throwing from `agentSession.prompt()`, so the dispatcher needs an
 * explicit signal to translate "Pi finished cleanly but the LLM call
 * failed" into `TaskResult.status='failed'`. Without this, a Pi-side
 * "out-of-credits" (HTTP 400) or any other upstream error silently
 * masquerades as a successful no-op spawn (cook.agent_result with
 * status="completed" + zero tokens) — the same anti-pattern as the
 * milestone-10 stderr leak / alpha.20 init error surfacing fixes.
 */
export type SwtEvent =
  | { readonly type: 'AGENT_START'; readonly sessionId: string }
  | { readonly type: 'AGENT_END'; readonly sessionId: string }
  | { readonly type: 'MESSAGE_DELTA'; readonly sessionId: string; readonly text: string }
  | { readonly type: 'TOOL_CALL'; readonly sessionId: string; readonly name: string }
  | { readonly type: 'TOOL_RESULT'; readonly sessionId: string; readonly name: string }
  | {
      readonly type: 'TASK_TOKEN_USAGE';
      readonly sessionId: string;
      readonly usage: TaskTokenUsage;
    }
  | {
      readonly type: 'TASK_ERROR';
      readonly sessionId: string;
      /**
       * Free-text error string from Pi's upstream API call (Anthropic /
       * OpenAI / etc.). Truncated by the dispatcher to fit
       * FAILED_SUMMARY_MAX_LEN when used as a `TaskResult.summary`. Carries
       * provider + model context as plain prose; structured upstream fields
       * are NOT split out here (Pi's `message.errorMessage` is typically
       * the raw HTTP body, which is the form the user actually needs to
       * see — e.g., `400 {"type":"error","error":{"message":"out of
       * credits"}}`).
       */
      readonly errorMessage: string;
    };
