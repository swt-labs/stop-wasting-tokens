import { randomUUID } from 'node:crypto';

import {
  AuthStorage,
  createAgentSession,
  InMemoryAuthStorageBackend,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';

import { mapPiEvent } from './events.js';
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
 * **`SwtSessionOptions.enableResultProtocol` + `.taskId` handling:**
 * Recorded by the adapter but NOT yet wired through Pi's extension
 * loader. Pi's `customTools` field on `createAgentSession` accepts
 * `ToolDefinition[]` — NOT extension-factory functions like
 * `buildResultProtocolExtension()` (which returns
 * `(pi: PiExtensionAPI) => void`). Wiring the extension factory
 * through Pi's extension-discovery path is a separate follow-up. For
 * `taskId`, the adapter writes a `task-context` custom session entry
 * when the field is set, so the extension (once wired) can pick it up
 * via `getTaskIdFromCtx`.
 *
 * **`SwtSessionOptions.provider` + `.resolvedCredential` handling
 * (Phase 2 — Selection → Spawn Wiring):** when BOTH are present,
 * `createSession` injects the keychain-resolved credential into Pi via an
 * `AuthStorage` backed by `InMemoryAuthStorageBackend` — RAM-only, freshly
 * constructed per spawn, NEVER Pi's plaintext `~/.pi/agent/auth.json`
 * (research §6). When either is absent, the call is byte-identical to the
 * pre-Phase-2 path (Pi falls through to its own `auth.json` + env-var
 * resolution). Phase 2 only handles the `'api_key'` auth mode; the
 * `'oauth'` branch is a clearly-commented Phase 4 stub. `SwtSessionOptions.model`
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
      // Phase 4 — oauth credential injection (a serialized OAuthCredentials
      // blob -> AuthStorage OAuthCredential). Phase 2 never produces an
      // 'oauth' resolvedCredential, so this branch is unreachable today; it
      // throws rather than silently mis-injecting an oauth blob as an
      // api_key. SWT-owns-refresh wiring lands in Phase 4.
      throw new Error(
        'createSession: oauth credential injection is not implemented until Phase 4',
      );
    }
    // `model` is intentionally NOT forwarded: Pi's `createAgentSession`
    // wants a resolved `Model<any>`, while `opts.model` is a model-id
    // string. Phase 2 never sets `opts.model` (Risk 8); omitting it lets
    // Pi's `ModelRegistry` resolve the chosen provider's default model. The
    // model-picker fast-follow owns the id -> `Model` resolution.
    const { session } = await createAgentSession({
      cwd: opts.cwd,
      sessionManager,
      authStorage,
    });
    agentSession = session;
  } else {
    // Pre-Phase-2 path — byte-identical to the original code. No `auth`
    // block configured, or the cook callsite resolved nothing (headless
    // host, env-fallback empty): Pi falls through to its own auth.json +
    // env-var resolution.
    const { session } = await createAgentSession({
      cwd: opts.cwd,
      sessionManager,
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
