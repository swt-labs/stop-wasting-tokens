import type { TokenMeter } from './meter.js';

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
}

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
    };
