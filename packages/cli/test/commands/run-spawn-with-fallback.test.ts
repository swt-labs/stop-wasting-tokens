/**
 * Plan 03-04 T3 (Phase 3 / G-R4) — onProjection hook behaviour in
 * runSpawnWithFallback.
 *
 * The Phase 2 runSpawnWithFallback tests live in cook-provider-fallback.test.ts
 * (router + fallback chain + onSelectionEvent / onProviderEvent telemetry).
 * This file covers the Plan 03-04 addition: the optional onProjection hook
 * fired once per spawn after the router resolves the primary provider, plus
 * the BudgetProjectionExceededError pre-spawn halt.
 *
 * Coverage:
 *   (1) projection halts pre-spawn — onProjection returns would_exceed: true →
 *       runSpawnWithFallback rejects with BudgetProjectionExceededError AND the
 *       spy spawnFn was NEVER called.
 *   (2) projection passes → spawn proceeds — onProjection returns
 *       would_exceed: false → resolves normally, spawnFn called.
 *   (3) onProjection undefined → Phase 2 behaviour — hook omitted →
 *       byte-identical to the Phase 2 path, spawnFn called, no throw.
 *   (4) onProjection fires exactly once after provider resolution — a counting
 *       stub is invoked exactly once and its ctx.provider equals the
 *       router-resolved primary for the fixture strategy.
 */

import type { BudgetProjectionResult, CostProjection } from '@swt-labs/runtime';
import type { TaskResult, TaskBrief } from '@swt-labs/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  BudgetProjectionExceededError,
  runSpawnWithFallback,
  type CookProvidersConfig,
} from '../../src/commands/cook.js';

const STUB_SPAWN_ARGS = {
  prompt: 'stub-prompt',
  cwd: '/tmp/swt-projection-test',
  sessionId: 'projection-test-session',
  installRoot: '/tmp/swt-projection-test/install',
  maxTurns: 10,
} as const;

const STUB_TASK_BRIEF: TaskBrief = {
  taskId: 'execute--',
  role: 'orchestrator',
  cwd: '/tmp/swt-projection-test',
};

const STUB_TASK_RESULT: TaskResult = {
  schema_version: 1,
  task_id: 'execute--',
  status: 'success',
  summary: 'ok',
  files_changed: [],
  must_haves: [],
};

const STUB_PROVIDERS: CookProvidersConfig = {
  strategy: { kind: 'pinned', provider: 'anthropic' },
  fallbacks: [],
  retryBudget: 3,
  timeBudgetMs: 30_000,
};

/** A minimal valid CostProjection fixture for the BudgetProjectionResult. */
function makeProjection(overrides: Partial<CostProjection> = {}): CostProjection {
  return {
    projected_cost_usd: 1.25,
    expected_cost_usd: 0.6,
    projected_input_tokens: 4000,
    projected_output_tokens: 8000,
    confidence: 'medium',
    assumptions: ['input estimated via char/4 heuristic'],
    rate_card_source: 'embedded',
    ...overrides,
  };
}

function makeProjectionResult(
  would_exceed: boolean,
  overrides: Partial<BudgetProjectionResult> = {},
): BudgetProjectionResult {
  return {
    would_exceed,
    projected_pressure: would_exceed ? 1.2 : 0.4,
    projection: makeProjection(),
    ...overrides,
  };
}

describe('Plan 03-04 T3 (G-R4) — runSpawnWithFallback onProjection hook', () => {
  it('(1) projection halts pre-spawn — rejects with BudgetProjectionExceededError, spawnFn never called', async () => {
    const spawnFnSpy = vi.fn(async () => STUB_TASK_RESULT);
    const onProjection = vi.fn(() => makeProjectionResult(true));

    await expect(
      runSpawnWithFallback({
        providers: STUB_PROVIDERS,
        spawnArgs: STUB_SPAWN_ARGS,
        spawnFn: spawnFnSpy,
        taskBrief: STUB_TASK_BRIEF,
        subSessionId: 'sub-halt',
        onProjection,
      }),
    ).rejects.toBeInstanceOf(BudgetProjectionExceededError);

    // The halt happens INSIDE runSpawnWithFallback, before the fallback
    // chain ever calls spawnFn — no money spent.
    expect(spawnFnSpy).not.toHaveBeenCalled();
    expect(onProjection).toHaveBeenCalledTimes(1);
  });

  it('(1b) the thrown BudgetProjectionExceededError carries the projection + projectionResult', async () => {
    const spawnFnSpy = vi.fn(async () => STUB_TASK_RESULT);
    const projectionResult = makeProjectionResult(true);

    let caught: unknown;
    try {
      await runSpawnWithFallback({
        providers: STUB_PROVIDERS,
        spawnArgs: STUB_SPAWN_ARGS,
        spawnFn: spawnFnSpy,
        taskBrief: STUB_TASK_BRIEF,
        onProjection: () => projectionResult,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BudgetProjectionExceededError);
    const err = caught as BudgetProjectionExceededError;
    expect(err.name).toBe('BudgetProjectionExceededError');
    expect(err.projectionResult).toBe(projectionResult);
    expect(err.projection).toBe(projectionResult.projection);
  });

  it('(2) projection passes → spawn proceeds — resolves normally, spawnFn called', async () => {
    const spawnFnSpy = vi.fn(async () => STUB_TASK_RESULT);
    const onProjection = vi.fn(() => makeProjectionResult(false));

    const out = await runSpawnWithFallback({
      providers: STUB_PROVIDERS,
      spawnArgs: STUB_SPAWN_ARGS,
      spawnFn: spawnFnSpy,
      taskBrief: STUB_TASK_BRIEF,
      subSessionId: 'sub-pass',
      onProjection,
    });

    expect(out.providerUsed).toBe('anthropic');
    expect(out.attempts).toBe(1);
    expect(spawnFnSpy).toHaveBeenCalledTimes(1);
    expect(onProjection).toHaveBeenCalledTimes(1);
  });

  it('(2b) onProjection returning undefined → spawn proceeds (handler-swallowed-error path)', async () => {
    // A handler that swallows an internal error returns undefined; the spawn
    // must proceed exactly as if no projection ran.
    const spawnFnSpy = vi.fn(async () => STUB_TASK_RESULT);
    const onProjection = vi.fn(() => undefined);

    const out = await runSpawnWithFallback({
      providers: STUB_PROVIDERS,
      spawnArgs: STUB_SPAWN_ARGS,
      spawnFn: spawnFnSpy,
      taskBrief: STUB_TASK_BRIEF,
      onProjection,
    });

    expect(out.providerUsed).toBe('anthropic');
    expect(spawnFnSpy).toHaveBeenCalledTimes(1);
    expect(onProjection).toHaveBeenCalledTimes(1);
  });

  it('(3) onProjection undefined → Phase 2 behaviour — spawnFn called, no throw', async () => {
    const spawnFnSpy = vi.fn(async () => STUB_TASK_RESULT);

    const out = await runSpawnWithFallback({
      providers: STUB_PROVIDERS,
      spawnArgs: STUB_SPAWN_ARGS,
      spawnFn: spawnFnSpy,
      taskBrief: STUB_TASK_BRIEF,
      // onProjection omitted entirely
    });

    expect(out.providerUsed).toBe('anthropic');
    expect(out.attempts).toBe(1);
    expect(spawnFnSpy).toHaveBeenCalledTimes(1);
  });

  it('(4) onProjection fires exactly once after provider resolution — ctx.provider is the router-resolved primary', async () => {
    const spawnFnSpy = vi.fn(async () => STUB_TASK_RESULT);
    const seenProviders: string[] = [];
    const onProjection = vi.fn((ctx: { provider: string; sub_session_id: string }) => {
      seenProviders.push(ctx.provider);
      return makeProjectionResult(false);
    });

    await runSpawnWithFallback({
      providers: STUB_PROVIDERS,
      spawnArgs: STUB_SPAWN_ARGS,
      spawnFn: spawnFnSpy,
      taskBrief: STUB_TASK_BRIEF,
      subSessionId: 'sub-once',
      onProjection,
    });

    // Exactly once per runSpawnWithFallback call.
    expect(onProjection).toHaveBeenCalledTimes(1);
    // The pinned strategy resolves the primary to 'anthropic'.
    expect(seenProviders).toEqual(['anthropic']);
    // The sub-session id is threaded through verbatim.
    expect(onProjection.mock.calls[0][0].sub_session_id).toBe('sub-once');
  });

  it('(4b) onProjection ctx.provider matches a cost-optimized-rate-card resolved primary', async () => {
    const spawnFnSpy = vi.fn(async () => STUB_TASK_RESULT);
    const seenProviders: string[] = [];

    const fixtureCard = {
      schema_version: 1 as const,
      source: 'embedded' as const,
      generated_at: '2026-05-14T00:00:00Z',
      entries: [
        {
          provider: 'openai',
          model: 'gpt-cheap',
          input_per_1k: 0.001,
          output_per_1k: 0.002,
          updated_at: '2026-05-14T00:00:00Z',
        },
        {
          provider: 'anthropic',
          model: 'claude-opus-4-7',
          input_per_1k: 0.015,
          output_per_1k: 0.075,
          updated_at: '2026-05-14T00:00:00Z',
        },
      ],
    };

    const providers: CookProvidersConfig = {
      strategy: {
        kind: 'cost-optimized-rate-card',
        providers: ['openai', 'anthropic'],
        rateCard: fixtureCard,
        dimension: 'input',
      },
      fallbacks: [],
      retryBudget: 3,
      timeBudgetMs: 30_000,
    };

    await runSpawnWithFallback({
      providers,
      spawnArgs: STUB_SPAWN_ARGS,
      spawnFn: spawnFnSpy,
      taskBrief: STUB_TASK_BRIEF,
      onProjection: (ctx) => {
        seenProviders.push(ctx.provider);
        return makeProjectionResult(false);
      },
    });

    // cost-optimized-rate-card picks the cheapest input → openai.
    expect(seenProviders).toEqual(['openai']);
    expect(spawnFnSpy).toHaveBeenCalledTimes(1);
  });
});
