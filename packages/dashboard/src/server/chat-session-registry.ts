/**
 * Plan 01-03 (milestone 12, Phase 01) — In-memory chat-session registry.
 *
 * Holds the live `SwtSession` handles created by `POST /api/chat` so a
 * subsequent POST carrying the same `chat_session_id` reuses the same Pi
 * `AgentSession` — Pi's `SessionManager.inMemory` accumulates conversation
 * history natively on the Pi side, so multi-turn "just works" by handing
 * the SAME session handle back to `session.prompt(text)` on each turn.
 *
 * **TTL sweep:** idle sessions are disposed after a configurable TTL
 * (default 10min). The sweep runs on a `setInterval(...).unref()` timer
 * so the daemon event loop is not pinned by the chat registry's
 * lifetime. The `close()` method clears the interval AND disposes any
 * still-registered sessions — wired into the dashboard server's
 * `close()` hook alongside `usageAggregator.close()` /
 * `budgetWiring.dispose()`.
 *
 * **Test seams:** `now` / `setIntervalFn` / `clearIntervalFn` are
 * injectable so tests can advance time deterministically without
 * touching the real clock or scheduler. Mirrors the `spawnFn` /
 * `initProject` / `bus` injection pattern used by `init.ts` +
 * `cook-start.ts`.
 */

import type { SwtSession } from '@swt-labs/runtime';

/**
 * The `(provider, model)` pair the cached `SwtSession` was created with.
 *
 * alpha.38 — Pi's `AgentSession` binds its auth + resolved model at
 * construction time (`runtime/src/session.ts:196` creates a fresh
 * `InMemoryAuthStorageBackend` per session; line ~235 resolves the
 * `model` string through `ModelRegistry.find()` and stores it on the
 * session). There is no in-place rebind path. So the chat route must
 * compare the registry entry's stamped binding to the current
 * `resolveActiveProvider()` result on every turn — when they diverge,
 * the cached session is stale and must be disposed so the next turn
 * gets a fresh session against the newly-selected provider/model.
 *
 * `model: null` means the session was created without an explicit
 * model id (Pi's default-model path was used). Two entries with
 * `model: null` are considered matching for the same provider.
 */
export interface ChatSessionBinding {
  readonly provider: string;
  readonly model: string | null;
}

export interface ChatEntry {
  readonly session: SwtSession;
  lastUsed: number;
  readonly chatSessionId: string;
  readonly binding: ChatSessionBinding;
}

export interface ChatSessionRegistryOptions {
  /** TTL before an idle session is swept + disposed. Default: 10 min. */
  ttlMs?: number;
  /** Sweep cadence. Default: ttlMs / 2 (with a 1000ms floor). */
  sweepIntervalMs?: number;
  /** Test seam for `Date.now`. */
  now?: () => number;
  /** Test seam for `setInterval`. */
  setIntervalFn?: typeof setInterval;
  /** Test seam for `clearInterval`. */
  clearIntervalFn?: typeof clearInterval;
}

export class ChatSessionRegistry {
  private readonly sessions = new Map<string, ChatEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly intervalHandle: ReturnType<typeof setInterval>;
  private readonly clearIntervalFn: typeof clearInterval;
  private closed = false;

  constructor(opts: ChatSessionRegistryOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
    const sweepMs = opts.sweepIntervalMs ?? Math.max(Math.floor(this.ttlMs / 2), 1000);
    this.now = opts.now ?? Date.now;
    const intervalFn = opts.setIntervalFn ?? setInterval;
    this.clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
    const handle = intervalFn(() => this.sweep(), sweepMs);
    // `.unref()` is a Node Timeout method only. Guard via `typeof` so the
    // test-seam `setIntervalFn` (which returns a plain `number` from
    // browser/JSDOM `window.setInterval`) doesn't crash the constructor.
    const maybeUnref = handle as { unref?: () => void };
    if (typeof maybeUnref.unref === 'function') {
      maybeUnref.unref();
    }
    this.intervalHandle = handle;
  }

  /**
   * Register a session under the given id with the `(provider, model)`
   * binding it was created against. If an entry already exists with a
   * DIFFERENT session instance, the prior session is disposed
   * (replace-and-dispose) so its Pi resources are released.
   *
   * **alpha.38 — `binding` is now required.** The chat route stamps every
   * registered session with the `(provider, model)` pair from
   * `resolveActiveProvider`, so `getMatching` can detect a stale entry
   * after the user switches the TopBar Provider / Model dropdown. The
   * three-arg signature is a breaking change inside the dashboard package
   * (only the chat route + tests call `set`). Compile errors at every
   * other call site are intentional: every caller MUST think about which
   * provider/model the session was created against.
   */
  set(chatSessionId: string, session: SwtSession, binding: ChatSessionBinding): void {
    if (this.closed) {
      throw new Error('ChatSessionRegistry: set() after close()');
    }
    const existing = this.sessions.get(chatSessionId);
    if (existing !== undefined && existing.session !== session) {
      try {
        existing.session.dispose();
      } catch {
        // Disposal must not throw out of the registry; swallow.
      }
    }
    this.sessions.set(chatSessionId, {
      session,
      lastUsed: this.now(),
      chatSessionId,
      binding,
    });
  }

  /**
   * Look up the session and refresh its `lastUsed` so it survives the
   * next sweep cycle. Returns `undefined` if no session is registered.
   *
   * **NOTE (alpha.38):** `get` is binding-unaware — it returns the cached
   * session regardless of which provider/model it was created against.
   * The chat route MUST use `getMatching` instead so a TopBar provider /
   * model switch invalidates the cached entry. `get` is preserved only
   * for the close-time disposal sweep + low-level test inspection.
   */
  get(chatSessionId: string): SwtSession | undefined {
    const entry = this.sessions.get(chatSessionId);
    if (entry === undefined) return undefined;
    entry.lastUsed = this.now();
    return entry.session;
  }

  /**
   * Look up the session ONLY when its stamped binding matches the
   * requested one. If the registry holds a session for `chatSessionId`
   * but its `(provider, model)` differs from the requested binding, the
   * stale session is disposed-and-removed and `undefined` is returned so
   * the caller falls through to its create-new-session path.
   *
   * Why dispose on mismatch:
   *   - Pi's `AgentSession` is bound to its `AuthStorage` + resolved
   *     `Model<Api>` at construction time (runtime/src/session.ts:196 +
   *     :235). There is no in-place rebind — keeping the cached entry
   *     around just keeps a dead handle alive until the TTL sweep.
   *   - The semantic intent of a provider/model switch IS "start a fresh
   *     conversation against the new vendor." Pi's `SessionManager.inMemory`
   *     history belongs to the disposed session by definition, so the
   *     next turn correctly starts from an empty conversation.
   *
   * `model: null` matches `model: null` (both ran the Pi-default path).
   * `model: 'a'` vs `model: 'b'` is a mismatch even when provider matches.
   */
  getMatching(chatSessionId: string, binding: ChatSessionBinding): SwtSession | undefined {
    const entry = this.sessions.get(chatSessionId);
    if (entry === undefined) return undefined;
    if (entry.binding.provider !== binding.provider || entry.binding.model !== binding.model) {
      // Stale — provider or model changed since this session was created.
      try {
        entry.session.dispose();
      } catch {
        // Disposal must not throw out of the registry; swallow.
      }
      this.sessions.delete(chatSessionId);
      return undefined;
    }
    entry.lastUsed = this.now();
    return entry.session;
  }

  /** Count of currently-registered sessions. */
  size(): number {
    return this.sessions.size;
  }

  /**
   * Dispose + remove any sessions whose `lastUsed` is older than
   * `now() - ttlMs`. Public-ish (exposed for the test seam tick path);
   * production code never needs to call this directly — the
   * `setInterval` loop drives it.
   */
  sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, entry] of this.sessions) {
      if (entry.lastUsed < cutoff) {
        try {
          entry.session.dispose();
        } catch {
          // Disposal must not crash the sweep; swallow per-entry errors.
        }
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Stop the sweep interval and dispose every still-registered session.
   * Idempotent — calling `close()` twice is a no-op. Any subsequent
   * `set()` throws (a hard signal that the daemon is shutting down).
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearIntervalFn(this.intervalHandle);
    for (const [, entry] of this.sessions) {
      try {
        entry.session.dispose();
      } catch {
        // Swallow disposal errors during shutdown.
      }
    }
    this.sessions.clear();
  }
}
