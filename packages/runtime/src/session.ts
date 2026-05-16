import { randomUUID } from 'node:crypto';

import type { OAuthCredentials } from '@earendil-works/pi-ai/oauth';
import {
  AuthStorage,
  createAgentSession,
  InMemoryAuthStorageBackend,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition as PiSdkToolDefinition,
} from '@earendil-works/pi-coding-agent';

import { mapPiEvent } from './events.js';
import type { PiExtensionAPI, PiToolDefinition } from './extensions/pi-types.js';
import type { SwtSession, SwtSessionOptions, SwtEvent, TokenMeter } from './types.js';

/**
 * Session factory — the runtime-layer wrapper over Pi's `AgentSession`.
 *
 * **Activated by the M3 session-wiring follow-up (PR-S).** Default
 * `createSession` now constructs a real Pi `AgentSession` via
 * `createAgentSession({ cwd, sessionManager })`. The prior mock
 * behaviour is preserved + exposed as the explicit `createMockSession`
 * helper for tests that don't need (or can't access) a real Pi auth /
 * model configuration.
 *
 * **Per Principle 1 (TDD2 §4.3):** this file is one of the few inside
 * `@swt-labs/runtime` that imports `@earendil-works/pi-coding-agent`
 * value-level. The rest of the codebase consumes sessions through the
 * vendor-neutral `SwtSession` contract.
 *
 * **Adapter contract:**
 *   - `prompt(text)` → `agentSession.prompt(text)` (Pi's send API).
 *   - `subscribe(listener)` → registers a Pi listener that runs every
 *     event through `mapPiEvent` (events.ts) before broadcasting to the
 *     SWT listener. The same fan-out fires `routeUsageToMeter` on
 *     `TASK_TOKEN_USAGE` so the meter bridge stays seamless.
 *   - `dispose()` → `agentSession.dispose()` + clears internal state.
 *   - `sessionId` → reads from Pi's `agentSession.sessionId` getter.
 *
 * **`SwtSessionOptions.extensionFactories` handling (Phase 03 plan 03-01 T3):**
 * The previously-deferred extension wiring is now ACTIVE for agent
 * sessions. Each factory `(pi: PiExtensionAPI) => void` is invoked once
 * against a recording `PiExtensionAPI` shim at the `createAgentSession`
 * call site; the captured `registerTool` definitions are forwarded as
 * Pi's `customTools[]`. Mirrors the orchestrator-session wiring slot at
 * `spawn-orchestrator-session.ts:~299` (the resolved-config `extensions`
 * field) — closes Scout's Phase 03 risk #1. Empty / absent extensions
 * keep the call byte-identical to pre-Phase-03 (no `customTools` set).
 *
 * **`SwtSessionOptions.enableResultProtocol` + `.taskId` handling:** the
 * dispatcher / spawn layer always supplies a `buildResultProtocolExtension()`
 * factory in `extensions[]` when `enableResultProtocol` is true, so the
 * boolean and the taskId travel together with the extension that consumes
 * them via `getTaskIdFromCtx`. The flags remain on `SwtSessionOptions`
 * for structural compatibility but the extension path is now the load-
 * bearing wire.
 *
 * **`SwtSessionOptions.provider` + `.resolvedCredential` handling
 * (Phase 2 — Selection → Spawn Wiring):** when BOTH are present,
 * `createSession` injects the keychain-resolved credential into Pi via an
 * `AuthStorage` backed by `InMemoryAuthStorageBackend` — RAM-only, freshly
 * constructed per spawn, NEVER Pi's plaintext `~/.pi/agent/auth.json`
 * (research §6). When either is absent, the call is byte-identical to the
 * pre-Phase-2 path (Pi falls through to its own `auth.json` + env-var
 * resolution). Phase 2 handles the `'api_key'` auth mode; Phase 4 (plan
 * 04-04) un-stubs the `'oauth'` branch — it `JSON.parse`s the serialized
 * `OAuthCredentials` blob from `resolvedCredential.secret` and injects the
 * Pi `OAuthCredential` shape (`{type:'oauth'} & OAuthCredentials`) onto the
 * SAME in-memory `AuthStorage`. `SwtSessionOptions.model`
 * is a model-id *string*, but Pi's `createAgentSession` takes a resolved
 * `Model<any>`; Phase 2 never sets `opts.model` (Risk 8) and never forwards
 * it — Pi's `ModelRegistry` resolves the provider's default model.
 */
export async function createSession(opts: SwtSessionOptions): Promise<SwtSession> {
  const sessionManager = opts.ephemeral
    ? SessionManager.inMemory(opts.cwd)
    : SessionManager.create(opts.cwd);

  let agentSession: AgentSession;
  if (opts.resolvedCredential !== undefined && opts.provider !== undefined) {
    // Phase 2 — inject the keychain-resolved credential via an in-memory
    // AuthStorage. InMemoryAuthStorageBackend keeps the secret RAM-only —
    // it is NEVER written to Pi's plaintext ~/.pi/agent/auth.json
    // (research §6). A fresh backend is constructed per spawn.
    const authStorage = AuthStorage.fromStorage(new InMemoryAuthStorageBackend());
    if (opts.resolvedCredential.authMode === 'api_key') {
      authStorage.set(opts.provider, {
        type: 'api_key',
        key: opts.resolvedCredential.secret,
      });
    } else {
      // Phase 4 (plan 04-04) — oauth credential injection. The cook callsite
      // (resolveSpawnCredential) resolves the keychain OAuthCredentials blob,
      // refreshes it if near-expiry (SWT-owns-refresh, Risk 2), and serializes
      // it into resolvedCredential.secret — `secret` is "an API-key string in
      // Phase 2; a serialized OAuthCredentials JSON blob in Phase 4" (Phase
      // 2-02's contract, verbatim). Deserialize it and inject the Pi
      // OAuthCredential shape ({type:'oauth'} & OAuthCredentials) onto the SAME
      // in-memory AuthStorage the 'api_key' branch uses. A corrupt blob throws
      // — it is NOT silently mis-injected as an api_key. The blob lives RAM-
      // only in this in-memory AuthStorage; it is NEVER logged.
      let oauthCredentials: OAuthCredentials;
      try {
        oauthCredentials = JSON.parse(opts.resolvedCredential.secret) as OAuthCredentials;
      } catch {
        throw new Error(
          'createSession: oauth resolvedCredential.secret is not a valid OAuthCredentials JSON blob',
        );
      }
      authStorage.set(opts.provider, { type: 'oauth', ...oauthCredentials });
    }
    // `model` is intentionally NOT forwarded: Pi's `createAgentSession`
    // wants a resolved `Model<any>`, while `opts.model` is a model-id
    // string. Phase 2 never sets `opts.model` (Risk 8); omitting it lets
    // Pi's `ModelRegistry` resolve the chosen provider's default model. The
    // model-picker fast-follow owns the id -> `Model` resolution.
    const customTools = materializeExtensionsToCustomTools(opts.extensionFactories);
    const { session } = await createAgentSession({
      cwd: opts.cwd,
      sessionManager,
      authStorage,
      // Phase 02 (plan 02-01 T1) — forward `thinkingLevel` to Pi's native
      // `createAgentSession({thinkingLevel})` option (sdk.d.ts:23). Closes the
      // silent-drop bug where `SpawnAgentSessionConfig.thinkingLevel` was
      // resolved at `resolveSpawnAgentConfig` but stripped at
      // `defaultSpawnSessionFactory`. Conditional-spread mirrors the
      // provider/model precedent above so absent stays absent.
      ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
      // Phase 03 plan 03-01 T3 — activated extensions[] passthrough. The
      // factories were resolved at the spawn-agent / spawn-orchestrator
      // layer; we materialize them here (recording PiExtensionAPI shim →
      // captured PiToolDefinition[] → Pi customTools[]). Absent / empty
      // input ⇒ no customTools key set (byte-identical to pre-Phase-03).
      // Cast through `unknown` because `PiToolDefinition` is a local
      // structural mirror of Pi's `ToolDefinition` (see pi-types.ts head
      // comment) and `readonly` reflects ownership in our runtime layer.
      ...(customTools.length > 0
        ? { customTools: customTools as unknown as PiSdkToolDefinition[] }
        : {}),
    });
    agentSession = session;
  } else {
    // Pre-Phase-2 path — byte-identical to the original code. No `auth`
    // block configured, or the cook callsite resolved nothing (headless
    // host, env-fallback empty): Pi falls through to its own auth.json +
    // env-var resolution.
    const customTools = materializeExtensionsToCustomTools(opts.extensionFactories);
    const { session } = await createAgentSession({
      cwd: opts.cwd,
      sessionManager,
      // Phase 02 (plan 02-01 T1) — same `thinkingLevel` forwarding as the
      // Phase-2 auth branch. Both call sites must include it so spawns
      // without resolved credentials still receive the frontmatter-driven
      // reasoning depth.
      ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
      // Phase 03 plan 03-01 T3 — same extensions activation as the
      // Phase-2 branch; both code paths must materialize so spawns without
      // resolved credentials still receive the registered custom tools.
      ...(customTools.length > 0
        ? { customTools: customTools as unknown as PiSdkToolDefinition[] }
        : {}),
    });
    agentSession = session;
  }

  return buildSwtSessionFromPi(agentSession, opts);
}

/**
 * Explicit mock factory — preserves the prior `makeMockSwtSession`
 * behaviour for tests that exercise the SwtSession contract (subscribe
 * registration, dispose semantics, meter-bridge fan-out via synthetic
 * events) without needing a real Pi auth/model configuration.
 *
 * Use this in unit tests; production callers (the dispatcher's default
 * factory) get the real `createSession` above.
 */
export async function createMockSession(opts: SwtSessionOptions): Promise<SwtSession> {
  return makeMockSwtSession(opts);
}

function buildSwtSessionFromPi(agentSession: AgentSession, opts: SwtSessionOptions): SwtSession {
  const sessionId = agentSession.sessionId;
  const meter = opts.meter;
  const meterContext = opts.meterContext;
  // `enableResultProtocol` + `taskId` are recorded structurally. The
  // task-context entry write is deferred until the Pi extension-loader
  // wiring lands (a separate follow-up); persisting the entry here
  // without the registered extension would leak protocol detail into
  // the session log with no consumer.
  void opts.enableResultProtocol;
  void opts.taskId;
  // Phase 2 — `provider` / `model` / `resolvedCredential` are consumed by
  // `createSession` BEFORE `buildSwtSessionFromPi` runs (the AuthStorage
  // injection happens at the `createAgentSession` call). The builder itself
  // never touches them — `void`-ed here for consistency with the precedent
  // above.
  void opts.provider;
  void opts.model;
  void opts.resolvedCredential;
  // Phase 02 (plan 02-01 T1) — `thinkingLevel` is consumed at the
  // `createAgentSession` call site above; void here mirrors the precedent
  // so the builder's typecheck covers the new field without re-consuming.
  void opts.thinkingLevel;
  // Phase 03 plan 03-01 T3 — `extensionFactories` materialized into `customTools`
  // BEFORE `buildSwtSessionFromPi` runs (the call sites above invoke
  // `materializeExtensionsToCustomTools(opts.extensionFactories)`). Voided here for
  // symmetry with the precedent.
  void opts.extensionFactories;

  let disposed = false;

  return {
    sessionId,
    async prompt(text: string): Promise<void> {
      if (disposed) {
        throw new Error('SwtSession: prompt() called after dispose()');
      }
      await agentSession.prompt(text);
    },
    subscribe(listener: (event: SwtEvent) => void): () => void {
      const unsubscribe = agentSession.subscribe((piEvent: AgentSessionEvent) => {
        const mapped = mapPiEvent(piEvent, sessionId);
        if (mapped === undefined) return;
        listener(mapped);
        if (meter !== undefined) {
          routeUsageToMeter(mapped, meter, meterContext);
        }
      });
      return unsubscribe;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      agentSession.dispose();
    },
  };
}

function makeMockSwtSession(opts: SwtSessionOptions): SwtSession {
  const sessionId = randomUUID();
  const listeners: Array<(event: SwtEvent) => void> = [];
  const meter = opts.meter;
  void opts.ephemeral;
  void opts.cwd;
  // PR-26 wiring: the runtime records `enableResultProtocol` + `taskId`
  // as no-ops on the mock. The real adapter above is where they will
  // wire through once the Pi extension-loader path lands.
  void opts.enableResultProtocol;
  void opts.taskId;
  // Phase 2 — `provider` / `model` / `resolvedCredential` are intentionally
  // inert on the mock path: it constructs NO AuthStorage, touches NO Pi,
  // injects NOTHING (Risk 5 mock-path-preservation). `void`-ed mirroring
  // the precedent above.
  void opts.provider;
  void opts.model;
  void opts.resolvedCredential;
  // Phase 02 (plan 02-01 T1) — `thinkingLevel` is inert on the mock path
  // (no real Pi session is constructed). `void`-ed so the new field still
  // typechecks against `SwtSessionOptions` for every test fixture.
  void opts.thinkingLevel;
  // Phase 03 plan 03-01 T3 — `extensionFactories` is inert on the mock path: no
  // real Pi `customTools[]` materialization happens because no real Pi
  // session is constructed. The factories are silently dropped.
  void opts.extensionFactories;

  let disposed = false;

  // Meter bridge: subscribe internally so externally-attached subscribers
  // don't have to know about meter routing. Mirrors the real adapter's
  // fan-out shape so test fixtures driving synthetic `TASK_TOKEN_USAGE`
  // events behave the same against either factory.
  if (meter !== undefined) {
    listeners.push((event) => {
      routeUsageToMeter(event, meter, opts.meterContext);
    });
  }

  return {
    sessionId,
    async prompt(_text: string): Promise<void> {
      if (disposed) {
        throw new Error('SwtSession: prompt() called after dispose()');
      }
      return Promise.resolve();
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    dispose() {
      disposed = true;
      listeners.length = 0;
    },
  };
}

/**
 * Phase 03 plan 03-01 T3 — invoke each session extension factory once
 * against a recording `PiExtensionAPI` shim and collect the resulting
 * `PiToolDefinition`s into a Pi `customTools[]`-shaped array.
 *
 * Each factory is the `(pi: PiExtensionAPI) => void` shape exported by
 * `buildResultProtocolExtension` / `buildJournalExtension` /
 * `buildApplyPatchExtension` / `buildSwtAskUserExtension`. The recording
 * shim captures `registerTool` calls; `on` and `appendEntry` are recorded
 * as no-ops on this code path (the Phase 03 extensions register tools
 * synchronously and only result-protocol's defensive `agent_end` listener
 * uses `on` — the listener is not wired in this pass; it remains a
 * deferred follow-up since Pi's per-session event listener attachment
 * happens via `agentSession.subscribe`, not `pi.on`).
 *
 * The cast to `customTools` at the call site is intentional: Pi's
 * `ToolDefinition` type lives behind the SDK boundary and is structurally
 * compatible with our `PiToolDefinition` mirror (see `pi-types.ts` head
 * comment).
 */
export function materializeExtensionsToCustomTools(
  extensions: SwtSessionOptions['extensionFactories'],
): ReadonlyArray<PiToolDefinition> {
  if (extensions === undefined || extensions.length === 0) {
    return [];
  }
  const collected: PiToolDefinition[] = [];
  const recordingPi: PiExtensionAPI = {
    registerTool(def) {
      collected.push(def);
    },
    on() {
      // No-op: the agent-session adapter does not bind `pi.on` listeners
      // today. The only existing on('agent_end') user is the result-
      // protocol defensive harvester, whose activation is a separate
      // follow-up. Recording silently here keeps the materialization
      // total: factories that call `pi.on(...)` are not blocked.
    },
    appendEntry() {
      // No-op for the same reason — the closure-captured appendEntry path
      // requires an active Pi session entry stream; the recording phase
      // runs BEFORE the AgentSession exists.
    },
  };
  for (const factory of extensions) {
    // Cast through `unknown` because `SessionExtensionFactory`'s parameter
    // is `unknown` (shared/L0 cannot reference PiExtensionAPI). The
    // runtime knows the concrete shape.
    (factory as unknown as (pi: PiExtensionAPI) => void)(recordingPi);
  }
  return collected;
}

/**
 * Translate a TASK_TOKEN_USAGE event into a MeterRecord row and push it
 * into the attached meter. Cost is left at 0 here — the cost calculation
 * runs in the dashboard / cli surface where the provider rate card is
 * resolved (kept out of the runtime so the runtime stays Pi-only).
 *
 * The function is module-private but exported for unit tests in
 * `runtime/test/meter/`.
 */
export function routeUsageToMeter(
  event: SwtEvent,
  meter: TokenMeter,
  ctx: SwtSessionOptions['meterContext'],
): void {
  if (event.type !== 'TASK_TOKEN_USAGE') return;
  const u = event.usage;
  const now = new Date().toISOString();
  meter.record(
    {
      timestamp: now,
      milestone: ctx?.milestone ?? '',
      phase: ctx?.phase ?? '',
      task_id: ctx?.task_id ?? '',
      role: ctx?.role ?? '',
      tier: ctx?.tier ?? '',
      provider: u.provider,
      model: u.model,
      turn: u.turn,
      input: u.input,
      output: u.output,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
    },
    0,
  );
}
