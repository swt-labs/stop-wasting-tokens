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

export interface ChatEntry {
  readonly session: SwtSession;
  lastUsed: number;
  readonly chatSessionId: string;
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
   * Register a session under the given id. If an entry already exists
   * with a DIFFERENT session instance, the prior session is disposed
   * (replace-and-dispose) so its Pi resources are released.
   */
  set(chatSessionId: string, session: SwtSession): void {
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
    });
  }

  /**
   * Look up the session and refresh its `lastUsed` so it survives the
   * next sweep cycle. Returns `undefined` if no session is registered.
   */
  get(chatSessionId: string): SwtSession | undefined {
    const entry = this.sessions.get(chatSessionId);
    if (entry === undefined) return undefined;
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
