import { describe, expect, it } from 'vitest';

import {
  SnapshotEventSchema,
  SNAPSHOT_EVENT_TYPES,
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
    ]);
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
