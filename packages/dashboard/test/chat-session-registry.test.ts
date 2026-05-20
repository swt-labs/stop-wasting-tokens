import type { SwtSession } from '@swt-labs/runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  ChatSessionRegistry,
  type ChatSessionBinding,
} from '../src/server/chat-session-registry.js';

/** Default binding for tests that don't care which provider/model the
 *  session was created against — alpha.38's `set` requires a binding,
 *  but the pre-existing registry tests cover the lifecycle generically. */
const DEFAULT_BINDING: ChatSessionBinding = { provider: 'anthropic', model: null };

/**
 * Plan 01-03 P01 — ChatSessionRegistry unit tests.
 *
 * Covers the five invariants from the plan:
 *   1. set + get round-trip
 *   2. get refreshes lastUsed (survives next sweep)
 *   3. TTL sweep evicts idle sessions + calls dispose()
 *   4. set with an existing id replaces + disposes the prior session
 *   5. close() clears the interval, disposes ALL sessions, and
 *      subsequent set() throws
 */

interface FakeSession extends SwtSession {
  readonly dispose: ReturnType<typeof vi.fn>;
}

function makeFakeSession(id = 'fake-session'): FakeSession {
  return {
    sessionId: id,
    prompt: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn(),
  };
}

/**
 * Fake setInterval that captures the (handler, ms) pair and returns a
 * sentinel handle. Tests pump time + drive the sweep by calling the
 * captured handler directly — no real timers, no flake from
 * vitest.useFakeTimers().
 */
function makeFakeInterval(): {
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
  fireSweep: () => void;
  clearedHandles: unknown[];
  registered: Array<{ handler: () => void; ms: number }>;
} {
  const registered: Array<{ handler: () => void; ms: number }> = [];
  const clearedHandles: unknown[] = [];
  const handle = { __fake__: true };
  const setIntervalFn = ((handler: () => void, ms: number) => {
    registered.push({ handler, ms });
    return handle;
  }) as unknown as typeof setInterval;
  const clearIntervalFn = ((h: unknown) => {
    clearedHandles.push(h);
  }) as unknown as typeof clearInterval;
  return {
    setIntervalFn,
    clearIntervalFn,
    fireSweep: () => {
      const entry = registered[0];
      if (!entry) throw new Error('no interval registered');
      entry.handler();
    },
    clearedHandles,
    registered,
  };
}

describe('ChatSessionRegistry', () => {
  it('round-trips set + get and returns the same SwtSession handle', () => {
    const { setIntervalFn, clearIntervalFn } = makeFakeInterval();
    const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
    const session = makeFakeSession('s1');
    registry.set('chat-1', session, DEFAULT_BINDING);
    expect(registry.get('chat-1')).toBe(session);
    expect(registry.size()).toBe(1);
    registry.close();
  });

  it('get refreshes lastUsed so a subsequent sweep does NOT evict the session', () => {
    const { setIntervalFn, clearIntervalFn, fireSweep } = makeFakeInterval();
    let nowVal = 0;
    const now = (): number => nowVal;
    const ttlMs = 1000;
    const registry = new ChatSessionRegistry({
      ttlMs,
      setIntervalFn,
      clearIntervalFn,
      now,
    });
    const session = makeFakeSession('s1');
    registry.set('chat-1', session, DEFAULT_BINDING);
    // Advance time PAST the TTL.
    nowVal = ttlMs + 500;
    // Refresh via get — lastUsed should now be `ttlMs + 500`.
    expect(registry.get('chat-1')).toBe(session);
    // Advance time another bit — still within TTL of the refreshed timestamp.
    nowVal = ttlMs + 600;
    fireSweep();
    expect(session.dispose).not.toHaveBeenCalled();
    expect(registry.size()).toBe(1);
    registry.close();
  });

  it('TTL sweep evicts idle sessions, calls dispose, and decrements size', () => {
    const { setIntervalFn, clearIntervalFn, fireSweep } = makeFakeInterval();
    let nowVal = 0;
    const ttlMs = 1000;
    const registry = new ChatSessionRegistry({
      ttlMs,
      setIntervalFn,
      clearIntervalFn,
      now: () => nowVal,
    });
    const session = makeFakeSession('s1');
    registry.set('chat-1', session, DEFAULT_BINDING);
    expect(registry.size()).toBe(1);
    // Advance past TTL without touching the entry.
    nowVal = ttlMs + 1;
    fireSweep();
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
    expect(registry.get('chat-1')).toBeUndefined();
    registry.close();
  });

  it('set with an existing id disposes the prior session (replace-and-dispose)', () => {
    const { setIntervalFn, clearIntervalFn } = makeFakeInterval();
    const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
    const first = makeFakeSession('first');
    const second = makeFakeSession('second');
    registry.set('chat-1', first, DEFAULT_BINDING);
    registry.set('chat-1', second, DEFAULT_BINDING);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(registry.get('chat-1')).toBe(second);
    expect(registry.size()).toBe(1);
    registry.close();
  });

  it('re-setting the SAME session instance does NOT call dispose', () => {
    const { setIntervalFn, clearIntervalFn } = makeFakeInterval();
    const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
    const session = makeFakeSession('s1');
    registry.set('chat-1', session, DEFAULT_BINDING);
    registry.set('chat-1', session, DEFAULT_BINDING); // same instance, same binding — must NOT dispose
    expect(session.dispose).not.toHaveBeenCalled();
    expect(registry.size()).toBe(1);
    registry.close();
  });

  it('close() clears the interval, disposes all sessions, and subsequent set() throws', () => {
    const { setIntervalFn, clearIntervalFn, clearedHandles, registered } = makeFakeInterval();
    const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
    const a = makeFakeSession('a');
    const b = makeFakeSession('b');
    registry.set('chat-a', a, DEFAULT_BINDING);
    registry.set('chat-b', b, DEFAULT_BINDING);
    expect(registry.size()).toBe(2);
    registry.close();
    expect(clearedHandles).toHaveLength(1);
    // It cleared the same handle registered at construction time.
    expect(clearedHandles[0]).toBe(registered[0]?.handler ? clearedHandles[0] : null);
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
    expect(() => registry.set('chat-c', makeFakeSession('c'), DEFAULT_BINDING)).toThrowError(
      /set\(\) after close\(\)/,
    );
  });

  it('close() is idempotent (second call is a no-op)', () => {
    const { setIntervalFn, clearIntervalFn, clearedHandles } = makeFakeInterval();
    const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
    registry.close();
    registry.close();
    expect(clearedHandles).toHaveLength(1);
  });

  it('dispose throwing during sweep does NOT crash the sweep (swallowed per-entry)', () => {
    const { setIntervalFn, clearIntervalFn, fireSweep } = makeFakeInterval();
    let nowVal = 0;
    const ttlMs = 1000;
    const registry = new ChatSessionRegistry({
      ttlMs,
      setIntervalFn,
      clearIntervalFn,
      now: () => nowVal,
    });
    const bad = makeFakeSession('bad');
    bad.dispose.mockImplementation(() => {
      throw new Error('dispose boom');
    });
    const good = makeFakeSession('good');
    registry.set('chat-bad', bad, DEFAULT_BINDING);
    registry.set('chat-good', good, DEFAULT_BINDING);
    nowVal = ttlMs + 1;
    expect(() => fireSweep()).not.toThrow();
    expect(bad.dispose).toHaveBeenCalledTimes(1);
    expect(good.dispose).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
    registry.close();
  });

  // ─── alpha.38 — binding-aware staleness check (`getMatching`) ──────────
  describe('getMatching (alpha.38 — mid-session provider/model invalidation)', () => {
    it('returns the cached session when binding matches', () => {
      const { setIntervalFn, clearIntervalFn } = makeFakeInterval();
      const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
      const session = makeFakeSession('s1');
      registry.set('chat-1', session, { provider: 'anthropic', model: null });
      expect(registry.getMatching('chat-1', { provider: 'anthropic', model: null })).toBe(session);
      expect(session.dispose).not.toHaveBeenCalled();
      expect(registry.size()).toBe(1);
      registry.close();
    });

    it('returns undefined and disposes when provider changes', () => {
      const { setIntervalFn, clearIntervalFn } = makeFakeInterval();
      const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
      const session = makeFakeSession('s1');
      registry.set('chat-1', session, { provider: 'anthropic', model: null });
      expect(
        registry.getMatching('chat-1', { provider: 'openrouter', model: null }),
      ).toBeUndefined();
      expect(session.dispose).toHaveBeenCalledTimes(1);
      expect(registry.size()).toBe(0);
      registry.close();
    });

    it('returns undefined and disposes when model changes (same provider)', () => {
      const { setIntervalFn, clearIntervalFn } = makeFakeInterval();
      const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
      const session = makeFakeSession('s1');
      registry.set('chat-1', session, { provider: 'anthropic', model: 'claude-opus-4' });
      expect(
        registry.getMatching('chat-1', { provider: 'anthropic', model: 'claude-sonnet-4' }),
      ).toBeUndefined();
      expect(session.dispose).toHaveBeenCalledTimes(1);
      expect(registry.size()).toBe(0);
      registry.close();
    });

    it('treats model: null vs model: "x" as a mismatch (both directions)', () => {
      const { setIntervalFn, clearIntervalFn } = makeFakeInterval();
      const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
      // null stamped, asked for explicit
      const sNullToExplicit = makeFakeSession('s-a');
      registry.set('a', sNullToExplicit, { provider: 'anthropic', model: null });
      expect(
        registry.getMatching('a', { provider: 'anthropic', model: 'claude-opus-4' }),
      ).toBeUndefined();
      expect(sNullToExplicit.dispose).toHaveBeenCalledTimes(1);

      // explicit stamped, asked for null
      const sExplicitToNull = makeFakeSession('s-b');
      registry.set('b', sExplicitToNull, { provider: 'anthropic', model: 'claude-opus-4' });
      expect(registry.getMatching('b', { provider: 'anthropic', model: null })).toBeUndefined();
      expect(sExplicitToNull.dispose).toHaveBeenCalledTimes(1);

      registry.close();
    });

    it('returns undefined for an unknown id (no dispose)', () => {
      const { setIntervalFn, clearIntervalFn } = makeFakeInterval();
      const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
      expect(registry.getMatching('nope', { provider: 'anthropic', model: null })).toBeUndefined();
      registry.close();
    });

    it('refreshes lastUsed on a matching lookup (survives next sweep)', () => {
      const { setIntervalFn, clearIntervalFn, fireSweep } = makeFakeInterval();
      let nowVal = 0;
      const ttlMs = 1000;
      const registry = new ChatSessionRegistry({
        ttlMs,
        setIntervalFn,
        clearIntervalFn,
        now: () => nowVal,
      });
      const session = makeFakeSession('s1');
      registry.set('chat-1', session, { provider: 'anthropic', model: null });
      // Advance past TTL of the initial `set` timestamp.
      nowVal = ttlMs + 500;
      expect(registry.getMatching('chat-1', { provider: 'anthropic', model: null })).toBe(session);
      // Still within TTL of the refreshed timestamp.
      nowVal = ttlMs + 600;
      fireSweep();
      expect(session.dispose).not.toHaveBeenCalled();
      expect(registry.size()).toBe(1);
      registry.close();
    });

    it('swallows dispose errors during stale-eviction', () => {
      const { setIntervalFn, clearIntervalFn } = makeFakeInterval();
      const registry = new ChatSessionRegistry({ setIntervalFn, clearIntervalFn, now: () => 0 });
      const session = makeFakeSession('s1');
      session.dispose.mockImplementation(() => {
        throw new Error('dispose boom');
      });
      registry.set('chat-1', session, { provider: 'anthropic', model: null });
      // Mismatch triggers dispose, which throws — getMatching must still
      // return undefined and the entry must still be evicted.
      expect(() =>
        registry.getMatching('chat-1', { provider: 'openrouter', model: null }),
      ).not.toThrow();
      expect(registry.size()).toBe(0);
      registry.close();
    });
  });
});
