import { describe, expect, it } from 'vitest';

import {
  CookBudgetProjectedEventSchema,
  SnapshotEventSchema,
  SNAPSHOT_EVENT_TYPES,
  type CookBudgetProjectedEvent,
  type CookEvent,
} from '../../src/schemas/events.js';

/**
 * Plan 04-01 (Phase 4) T1 — SnapshotEvent gains nine `cook.*` discriminated-
 * union variants for the file-tail IPC channel (R1 decision: write JSONL
 * to `.swt-planning/.events/*.jsonl` which the dashboard's
 * events-tailer.ts already consumes; no UDS socket). The variants are the
 * wire format every other plan in Phase 4 keys off.
 */

const TS = '2026-05-13T00:00:00.000Z';
const SID = 'cook-test-session';
const SUB = 'sub-test-session';

describe('@swt-labs/shared — CookEvent variants', () => {
  it('SNAPSHOT_EVENT_TYPES enumerates the cook.* variants', () => {
    const cookTypes = SNAPSHOT_EVENT_TYPES.filter((t) => t.startsWith('cook.'));
    expect(cookTypes).toEqual([
      'cook.priority_decision',
      'cook.agent_spawn',
      'cook.agent_result',
      'cook.tool_call',
      'cook.tool_result',
      'cook.file_write',
      'cook.commit',
      'cook.error',
      'cook.completion',
      // Plan 06-01 (Phase 6) — task lifecycle + resume variants on the
      // same cook events JSONL channel.
      'cook.task_start',
      'cook.task_commit',
      'cook.task_complete',
      'cook.task_fail',
      'cook.resume',
      // Plan 06-02 T4 (REQ-16) — BudgetGate task-loop integration emits
      // cook.budget_exceeded (paused_on_entry | paused_during_spawn) when
      // the milestone budget is exhausted, and cook.budget_resume after
      // a manual ceiling bump via /api/budget/bump.
      'cook.budget_exceeded',
      'cook.budget_resume',
      // Plan 06-03 T1 (R6) — one-time worktree-isolation warning emitted
      // at runMode start when `worktree_isolation: 'off'` AND the active
      // phase carries 2+ parallel plans (Phase 4 Wave 2 staging-race
      // mitigation signal).
      'cook.worktree_isolation_warning',
      // Plan 02-04 (Phase 2 / G-R3) — provider-router telemetry:
      // cook.provider_selected fires per spawn with the strategy provenance;
      // cook.provider_fallback dual-emits the stderr-only fallback transition
      // onto the JSONL channel.
      'cook.provider_selected',
      'cook.provider_fallback',
      // Plan 03-02 (Phase 3 / G-R4) — pre-spawn cost forecast emitted once
      // per spawn (whether the projection halts or passes).
      'cook.budget_projected',
    ]);
  });

  it('cook.worktree_isolation_warning parses with parallel_plans count', () => {
    const ok = SnapshotEventSchema.safeParse({
      type: 'cook.worktree_isolation_warning',
      ts: TS,
      session_id: SID,
      parallel_plans: 3,
    });
    expect(ok.success).toBe(true);
  });

  it('cook.priority_decision parses with required + optional fields', () => {
    const ok = SnapshotEventSchema.safeParse({
      type: 'cook.priority_decision',
      ts: TS,
      session_id: SID,
      priority: 5,
      mode: 'execute',
      phase_target: '01',
    });
    expect(ok.success).toBe(true);
  });

  it('cook.priority_decision rejects out-of-range priority', () => {
    const bad = SnapshotEventSchema.safeParse({
      type: 'cook.priority_decision',
      ts: TS,
      session_id: SID,
      priority: 12,
      mode: 'execute',
    });
    expect(bad.success).toBe(false);
  });

  it('cook.agent_spawn parses with role + sub_session_id', () => {
    const ok = SnapshotEventSchema.safeParse({
      type: 'cook.agent_spawn',
      ts: TS,
      session_id: SID,
      role: 'dev',
      sub_session_id: SUB,
    });
    expect(ok.success).toBe(true);
  });

  it('cook.agent_result accepts a usage payload with optional cache + cost', () => {
    const ok = SnapshotEventSchema.safeParse({
      type: 'cook.agent_result',
      ts: TS,
      session_id: SID,
      sub_session_id: SUB,
      status: 'completed',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
        cost_usd: 0.01,
      },
    });
    expect(ok.success).toBe(true);

    // usage.cost_usd is optional
    const noCost = SnapshotEventSchema.safeParse({
      type: 'cook.agent_result',
      ts: TS,
      session_id: SID,
      sub_session_id: SUB,
      status: 'failed',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(noCost.success).toBe(true);
  });

  it('cook.tool_call / cook.tool_result enforce 500-char excerpt cap', () => {
    const okCall = SnapshotEventSchema.safeParse({
      type: 'cook.tool_call',
      ts: TS,
      session_id: SID,
      sub_session_id: SUB,
      tool: 'Read',
      input_excerpt: 'x',
    });
    expect(okCall.success).toBe(true);

    const tooLong = SnapshotEventSchema.safeParse({
      type: 'cook.tool_call',
      ts: TS,
      session_id: SID,
      sub_session_id: SUB,
      tool: 'Read',
      input_excerpt: 'x'.repeat(501),
    });
    expect(tooLong.success).toBe(false);

    const okResult = SnapshotEventSchema.safeParse({
      type: 'cook.tool_result',
      ts: TS,
      session_id: SID,
      sub_session_id: SUB,
      tool: 'Read',
      result_excerpt: 'ok',
      duration_ms: 123,
    });
    expect(okResult.success).toBe(true);
  });

  it('cook.file_write + cook.commit parse', () => {
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.file_write',
        ts: TS,
        session_id: SID,
        path: '.swt-planning/phases/04/foo.md',
        bytes: 42,
      }).success,
    ).toBe(true);
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.commit',
        ts: TS,
        session_id: SID,
        commit_sha: 'abc1234',
        message: 'feat(scope): description',
      }).success,
    ).toBe(true);
  });

  it('cook.error parses with optional mode', () => {
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.error',
        ts: TS,
        session_id: SID,
        code: 'ESPAWN',
        message: 'spawn failed',
      }).success,
    ).toBe(true);
  });

  it('cook.completion accepts success / failed / cancelled', () => {
    for (const status of ['success', 'failed', 'cancelled'] as const) {
      const ok = SnapshotEventSchema.safeParse({
        type: 'cook.completion',
        ts: TS,
        session_id: SID,
        status,
      });
      expect(ok.success, `status=${status}`).toBe(true);
    }
  });

  it('CookEvent type alias narrows to cook.* variants at compile time', () => {
    const ev: CookEvent = {
      type: 'cook.priority_decision',
      ts: TS,
      session_id: SID,
      priority: 5,
      mode: 'execute',
    };
    expect(ev.type.startsWith('cook.')).toBe(true);
  });

  it('cook.provider_selected parses with required + strategy-specific optional fields', () => {
    // Minimal pinned spawn — only the required fields.
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.provider_selected',
        ts: TS,
        session_id: SID,
        sub_session_id: SUB,
        selected_provider: 'anthropic',
        selected_via: 'pinned',
      }).success,
    ).toBe(true);

    // cost-optimized-rate-card carries dimension + rate_card_* metadata.
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.provider_selected',
        ts: TS,
        session_id: SID,
        sub_session_id: SUB,
        selected_provider: 'openrouter',
        selected_via: 'cost-optimized-rate-card',
        dimension: 'input',
        rate_card_source: 'embedded',
        rate_card_age_ms: 86_400_000,
      }).success,
    ).toBe(true);

    // tier-routed-compound:fallback-strategy composition hint is accepted.
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.provider_selected',
        ts: TS,
        session_id: SID,
        sub_session_id: SUB,
        selected_provider: 'openai',
        selected_via: 'tier-routed-compound:fallback-strategy',
        tier: 'standard-fast',
      }).success,
    ).toBe(true);

    // Unknown selected_via value is rejected.
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.provider_selected',
        ts: TS,
        session_id: SID,
        sub_session_id: SUB,
        selected_provider: 'anthropic',
        selected_via: 'magic',
      }).success,
    ).toBe(false);
  });

  it('cook.provider_fallback parses with from/to/reason/attempt', () => {
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.provider_fallback',
        ts: TS,
        session_id: SID,
        sub_session_id: SUB,
        from: 'anthropic',
        to: 'openai',
        reason: '503',
        attempt: 2,
      }).success,
    ).toBe(true);

    // attempt must be a positive integer.
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.provider_fallback',
        ts: TS,
        session_id: SID,
        sub_session_id: SUB,
        from: 'anthropic',
        to: 'openai',
        reason: '503',
        attempt: 0,
      }).success,
    ).toBe(false);

    // reason must be one of the recognised classifications.
    expect(
      SnapshotEventSchema.safeParse({
        type: 'cook.provider_fallback',
        ts: TS,
        session_id: SID,
        sub_session_id: SUB,
        from: 'anthropic',
        to: 'openai',
        reason: '418',
        attempt: 1,
      }).success,
    ).toBe(false);
  });

  it('cook.askUser_* discriminators do NOT exist (use prompt.request/response)', () => {
    const bad = SnapshotEventSchema.safeParse({
      type: 'cook.askUser_prompt',
      ts: TS,
      session_id: SID,
      question: 'x',
    });
    expect(bad.success).toBe(false);
  });
});

/**
 * Plan 03-02 (Phase 3 / G-R4) T2 — `cook.budget_projected` is the pre-spawn
 * cost-forecast event plan 03-04 emits from a CostProjection + gate.project()
 * result. A pure-additive member of SnapshotEventSchema (mirrors the Phase 2
 * cook.provider_* additions). Covers parse round-trip, discriminated-union
 * narrowing on `type === 'cook.budget_projected'`, and the rejection /
 * acceptance edges — the assumptions PIPE_BUF caps (.max(8) entries +
 * .string().max(80) chars), missing would_exceed, and projected_pressure: 1.5
 * ACCEPTED (no `.max()` — a projection can blow past the ceiling).
 */
describe('@swt-labs/shared — cook.budget_projected event', () => {
  const validBudgetProjected: CookBudgetProjectedEvent = {
    type: 'cook.budget_projected',
    ts: TS,
    session_id: SID,
    sub_session_id: SUB,
    projected_cost_usd: 0.42,
    spent_usd: 1.18,
    ceiling_usd: 2.0,
    projected_pressure: 0.8,
    would_exceed: true,
    confidence: 'low',
    assumptions: [
      'input estimated via char/4 heuristic',
      'output bounded at maxTurns(40) x 800 tok/turn worst case',
      'cache priced cold (no prefix reuse assumed)',
    ],
    rate_card_source: 'embedded',
  };

  it('parses a valid cook.budget_projected round-trip (deep-equals input)', () => {
    const parsed = CookBudgetProjectedEventSchema.parse(validBudgetProjected);
    expect(parsed).toEqual(validBudgetProjected);
  });

  it('is a discriminated-union member that narrows on type', () => {
    const parsed = SnapshotEventSchema.parse(validBudgetProjected);
    // TypeScript narrows the union on the literal discriminator — the
    // budget-projection fields are only visible inside this branch.
    if (parsed.type === 'cook.budget_projected') {
      expect(parsed.projected_cost_usd).toBe(0.42);
      expect(parsed.would_exceed).toBe(true);
      expect(parsed.confidence).toBe('low');
    } else {
      throw new Error(`expected cook.budget_projected, got ${parsed.type}`);
    }
  });

  it('rejects an assumptions array over the 8-entry cap', () => {
    const tooMany = {
      ...validBudgetProjected,
      assumptions: Array.from({ length: 9 }, (_, i) => `assumption ${i}`),
    };
    expect(CookBudgetProjectedEventSchema.safeParse(tooMany).success).toBe(false);
  });

  it('rejects an assumptions entry over the 80-char cap', () => {
    const tooLong = {
      ...validBudgetProjected,
      assumptions: ['x'.repeat(81)],
    };
    expect(CookBudgetProjectedEventSchema.safeParse(tooLong).success).toBe(false);
  });

  it('rejects an object missing would_exceed', () => {
    const { would_exceed: _omit, ...withoutWouldExceed } = validBudgetProjected;
    expect(CookBudgetProjectedEventSchema.safeParse(withoutWouldExceed).success).toBe(false);
  });

  it('ACCEPTS projected_pressure > 1.0 (no .max() — a projection can blow past the ceiling)', () => {
    const overPressure = { ...validBudgetProjected, projected_pressure: 1.5 };
    expect(CookBudgetProjectedEventSchema.safeParse(overPressure).success).toBe(true);
    // The discriminated union accepts it too.
    expect(SnapshotEventSchema.safeParse(overPressure).success).toBe(true);
  });
});
