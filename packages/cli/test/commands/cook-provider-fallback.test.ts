/**
 * Plan 06-02 T3 (REQ-15) — provider router + fallback chain wired into
 * cook.ts:runMode spawn callsite.
 *
 * Coverage:
 *   (a) Router picks the primary; spawn succeeds first attempt → no fallback hop.
 *   (b) Primary fails with a recognised retryable reason (503) → chain
 *       advances to first fallback; second spawn succeeds.
 *   (c) Dual exhaustion (request-count + time-budget) terminates the chain;
 *       FallbackChainExhaustedError surfaces to the caller.
 *   (d) Non-retryable error (`'other'` classification) re-throws without
 *       consuming a fallback hop.
 */

import { describe, expect, it, vi } from 'vitest';

import type { TaskResult, TaskBrief } from '@swt-labs/shared';
import {
  FallbackChainExhaustedError,
  type ProviderFallbackEvent,
} from '@swt-labs/orchestration';

import {
  DEFAULT_PROVIDERS_CONFIG,
  classifyError,
  runSpawnWithFallback,
  type CookProvidersConfig,
} from '../../src/commands/cook.js';

const STUB_SPAWN_ARGS = {
  prompt: 'stub-prompt',
  cwd: '/tmp/swt-fallback-test',
  sessionId: 'fallback-test-session',
  installRoot: '/tmp/swt-fallback-test/install',
  maxTurns: 10,
} as const;

const STUB_TASK_BRIEF: TaskBrief = {
  taskId: 'execute--',
  role: 'orchestrator',
  cwd: '/tmp/swt-fallback-test',
};

const STUB_TASK_RESULT: TaskResult = {
  schema_version: 1,
  task_id: 'execute--',
  status: 'success',
  summary: 'ok',
  files_changed: [],
  must_haves: [],
};

describe('Plan 06-02 T3 — runSpawnWithFallback', () => {
  it('(a) primary picks via router; single spawn call on success', async () => {
    const spawnImpl = vi.fn(async () => STUB_TASK_RESULT);
    const events: ProviderFallbackEvent[] = [];

    const providers: CookProvidersConfig = {
      strategy: { kind: 'pinned', provider: 'anthropic' },
      fallbacks: ['openai', 'openrouter'],
      retryBudget: 3,
      timeBudgetMs: 30_000,
    };

    const out = await runSpawnWithFallback({
      providers,
      spawnArgs: STUB_SPAWN_ARGS,
      spawnFn: spawnImpl as never,
      taskBrief: STUB_TASK_BRIEF,
      onProviderEvent: (ev) => events.push(ev),
    });

    expect(out.providerUsed).toBe('anthropic');
    expect(out.attempts).toBe(1);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]); // no fallback events on happy path
  });

  it('(b) primary fails with 503 → chain advances to first fallback; spawn succeeds', async () => {
    const spawnImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('Pi adapter auto_retry_503 — provider returned 503'))
      .mockResolvedValueOnce(STUB_TASK_RESULT);
    const events: ProviderFallbackEvent[] = [];

    const providers: CookProvidersConfig = {
      strategy: { kind: 'pinned', provider: 'anthropic' },
      fallbacks: ['openai'],
      retryBudget: 3,
      timeBudgetMs: 30_000,
    };

    const out = await runSpawnWithFallback({
      providers,
      spawnArgs: STUB_SPAWN_ARGS,
      spawnFn: spawnImpl as never,
      taskBrief: STUB_TASK_BRIEF,
      onProviderEvent: (ev) => events.push(ev),
    });

    expect(out.providerUsed).toBe('openai');
    expect(out.attempts).toBe(2);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'provider.fallback_fired',
      from: 'anthropic',
      to: 'openai',
      reason: '503',
      attempt: 2,
    });
  });

  it('(c) dual exhaustion — request-count budget runs out before chain succeeds', async () => {
    // Every spawn fails 503 → chain runs out of providers before success.
    const spawnImpl = vi.fn(async () => {
      throw new Error('Pi auto_retry_503');
    });
    const events: ProviderFallbackEvent[] = [];

    const providers: CookProvidersConfig = {
      strategy: { kind: 'pinned', provider: 'anthropic' },
      fallbacks: ['openai'],
      retryBudget: 5, // high — request-count won't bite first
      timeBudgetMs: 30_000,
    };

    await expect(
      runSpawnWithFallback({
        providers,
        spawnArgs: STUB_SPAWN_ARGS,
        spawnFn: spawnImpl as never,
        taskBrief: STUB_TASK_BRIEF,
        onProviderEvent: (ev) => events.push(ev),
      }),
    ).rejects.toBeInstanceOf(FallbackChainExhaustedError);

    // primary + 1 fallback = 2 attempts, then exhaustion.
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it('(c′) time-budget exhaustion fires when wall clock exceeds budget', async () => {
    const spawnImpl = vi.fn(async () => {
      throw new Error('Pi auto_retry_503');
    });

    let t = 0;
    // Synthetic clock — each call jumps 100ms forward. With timeBudgetMs=50,
    // the second recordFailure (which checks elapsed) trips time_budget
    // before the request_count check could.
    const clock = (): number => {
      const v = t;
      t += 100;
      return v;
    };

    const providers: CookProvidersConfig = {
      strategy: { kind: 'pinned', provider: 'anthropic' },
      fallbacks: ['openai', 'openrouter', 'mistral'],
      retryBudget: 10, // very high — time_budget MUST fire first
      timeBudgetMs: 50,
    };

    let caught: unknown;
    try {
      await runSpawnWithFallback({
        providers,
        spawnArgs: STUB_SPAWN_ARGS,
        spawnFn: spawnImpl as never,
        taskBrief: STUB_TASK_BRIEF,
        clock,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(FallbackChainExhaustedError);
    expect((caught as FallbackChainExhaustedError).path).toBe('time_budget');
  });

  it('(d) non-retryable error (`other` classification) re-throws without fallback hop', async () => {
    const orig = new Error('TypeError: nope — not a recognised retry marker');
    const spawnImpl = vi.fn(async () => {
      throw orig;
    });
    const events: ProviderFallbackEvent[] = [];

    const providers: CookProvidersConfig = {
      strategy: { kind: 'pinned', provider: 'anthropic' },
      fallbacks: ['openai', 'openrouter'],
      retryBudget: 3,
      timeBudgetMs: 30_000,
    };

    await expect(
      runSpawnWithFallback({
        providers,
        spawnArgs: STUB_SPAWN_ARGS,
        spawnFn: spawnImpl as never,
        taskBrief: STUB_TASK_BRIEF,
        onProviderEvent: (ev) => events.push(ev),
      }),
    ).rejects.toBe(orig);

    expect(spawnImpl).toHaveBeenCalledTimes(1); // no retry on 'other'
    expect(events).toEqual([]);
  });

  it('defaults preserve single-provider behavior — empty fallbacks = degenerate chain', async () => {
    const spawnImpl = vi.fn(async () => STUB_TASK_RESULT);
    const out = await runSpawnWithFallback({
      providers: DEFAULT_PROVIDERS_CONFIG,
      spawnArgs: STUB_SPAWN_ARGS,
      spawnFn: spawnImpl as never,
      taskBrief: STUB_TASK_BRIEF,
    });
    expect(out.providerUsed).toBe('anthropic');
    expect(out.attempts).toBe(1);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Plan 06-02 T3 — classifyError', () => {
  it('maps auto_retry_503 markers to "503"', () => {
    expect(classifyError(new Error('Pi adapter auto_retry_503'))).toBe('503');
    expect(classifyError(new Error('HTTP 503 Service Unavailable'))).toBe('503');
  });
  it('maps auto_retry_429 markers to "429"', () => {
    expect(classifyError(new Error('auto_retry_429 rate limited'))).toBe('429');
    expect(classifyError(new Error('429 Too Many Requests'))).toBe('429');
  });
  it('maps auto_retry_500 markers to "500"', () => {
    expect(classifyError(new Error('auto_retry_500 internal server error'))).toBe('500');
    expect(classifyError(new Error('HTTP 500'))).toBe('500');
  });
  it('returns "other" for unrecognised errors', () => {
    expect(classifyError(new Error('connection refused'))).toBe('other');
    expect(classifyError(new TypeError('not a function'))).toBe('other');
    expect(classifyError('plain string')).toBe('other');
  });
});
