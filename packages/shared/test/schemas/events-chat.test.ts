import { describe, expect, it } from 'vitest';

import {
  SnapshotEventSchema,
  SNAPSHOT_EVENT_TYPES,
  type ChatStartEvent,
  type ChatMessageDeltaEvent,
  type ChatToolCallEvent,
  type ChatMessageEndEvent,
  type ChatTokenUsageEvent,
  type ChatErrorEvent,
  type ChatCompleteEvent,
  type ChatEvent,
} from '../../src/schemas/events.js';

/**
 * Plan 01-02 (milestone 12, Phase 01) T2 — schema round-trip + union-
 * membership tests for the 7 new chat.* event variants. Locks the wire
 * contract before plan 01-03's /api/chat route + Phase 03's ChatPanel
 * store fold key off these shapes.
 *
 * Lead decisions enforced by these tests:
 *   - chat_session_id is the correlation field (NOT session_id).
 *   - ChatErrorEvent.code is a CLOSED 4-value enum.
 *   - ChatTokenUsage flat usage shape matches TASK_TOKEN_USAGE for REQ-05
 *     meter parity.
 */

const TS = '2026-05-16T12:00:00.000Z';
const CSID = 'chat-test-session-01HXYZ';

const CHAT_EVENT_TYPES = [
  'chat.start',
  'chat.message_delta',
  'chat.tool_call',
  'chat.message_end',
  'chat.token_usage',
  'chat.error',
  'chat.complete',
] as const;

describe('@swt-labs/shared — ChatEvent variants', () => {
  // --- Round-trip parse (one per event variant — 7 cases) -----------------

  it('round-trips chat.start through SnapshotEventSchema', () => {
    const event: ChatStartEvent = {
      type: 'chat.start',
      ts: TS,
      chat_session_id: CSID,
      prompt: 'Hello, who are you?',
    };
    const wire = JSON.parse(JSON.stringify(event));
    const parsed = SnapshotEventSchema.parse(wire);
    expect(parsed).toEqual(event);
  });

  it('round-trips chat.message_delta through SnapshotEventSchema', () => {
    const event: ChatMessageDeltaEvent = {
      type: 'chat.message_delta',
      ts: TS,
      chat_session_id: CSID,
      text: 'I am an AI assistant.',
    };
    const wire = JSON.parse(JSON.stringify(event));
    const parsed = SnapshotEventSchema.parse(wire);
    expect(parsed).toEqual(event);
  });

  it('round-trips chat.tool_call through SnapshotEventSchema', () => {
    const event: ChatToolCallEvent = {
      type: 'chat.tool_call',
      ts: TS,
      chat_session_id: CSID,
      tool: 'read_file',
    };
    const wire = JSON.parse(JSON.stringify(event));
    const parsed = SnapshotEventSchema.parse(wire);
    expect(parsed).toEqual(event);
  });

  it('round-trips chat.message_end through SnapshotEventSchema', () => {
    const event: ChatMessageEndEvent = {
      type: 'chat.message_end',
      ts: TS,
      chat_session_id: CSID,
    };
    const wire = JSON.parse(JSON.stringify(event));
    const parsed = SnapshotEventSchema.parse(wire);
    expect(parsed).toEqual(event);
  });

  it('round-trips chat.token_usage through SnapshotEventSchema (meter shape parity)', () => {
    // Flat input/output/cacheRead/cacheWrite/provider/model mirrors
    // TASK_TOKEN_USAGE.usage so REQ-05 meter pipeline consumes with no
    // shape translation.
    const event: ChatTokenUsageEvent = {
      type: 'chat.token_usage',
      ts: TS,
      chat_session_id: CSID,
      input: 1234,
      output: 567,
      cacheRead: 89,
      cacheWrite: 0,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    };
    const wire = JSON.parse(JSON.stringify(event));
    const parsed = SnapshotEventSchema.parse(wire);
    expect(parsed).toEqual(event);
  });

  it('round-trips chat.error through SnapshotEventSchema (closed enum)', () => {
    const event: ChatErrorEvent = {
      type: 'chat.error',
      ts: TS,
      chat_session_id: CSID,
      code: 'CHAT_AUTH_FAILED',
      message: 'No credential found for provider anthropic',
    };
    const wire = JSON.parse(JSON.stringify(event));
    const parsed = SnapshotEventSchema.parse(wire);
    expect(parsed).toEqual(event);
  });

  it('round-trips chat.complete through SnapshotEventSchema', () => {
    const event: ChatCompleteEvent = {
      type: 'chat.complete',
      ts: TS,
      chat_session_id: CSID,
    };
    const wire = JSON.parse(JSON.stringify(event));
    const parsed = SnapshotEventSchema.parse(wire);
    expect(parsed).toEqual(event);
  });

  // --- Union membership (1 test, loops all 7) -----------------------------

  it('SNAPSHOT_EVENT_TYPES contains every chat.* type', () => {
    for (const t of CHAT_EVENT_TYPES) {
      expect(SNAPSHOT_EVENT_TYPES).toContain(t);
    }
  });

  // --- Negative cases (≥3) -----------------------------------------------

  it('rejects chat.start without prompt (required field)', () => {
    const bad = {
      type: 'chat.start',
      ts: TS,
      chat_session_id: CSID,
      // prompt missing
    };
    const result = SnapshotEventSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects chat.error with an unknown code (closed enum)', () => {
    const bad = {
      type: 'chat.error',
      ts: TS,
      chat_session_id: CSID,
      code: 'CHAT_UNKNOWN',
      message: 'something broke',
    };
    const result = SnapshotEventSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects chat.token_usage with a negative input count (non-negative int)', () => {
    const bad = {
      type: 'chat.token_usage',
      ts: TS,
      chat_session_id: CSID,
      input: -1,
      output: 100,
      cacheRead: 0,
      cacheWrite: 0,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    };
    const result = SnapshotEventSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  // --- Type-level probe (compile-time only) -------------------------------

  it('ChatEvent type extracts only chat.* members from SnapshotEvent', () => {
    // The actual narrowing happens at compile time; the runtime body just
    // asserts the probe constants land. The @ts-expect-error directive on
    // the second const verifies that non-chat types are rejected from
    // ChatEvent['type'] — if the extraction were too wide, the directive
    // would become an unused-directive error.
    const _typeProbe: ChatEvent['type'] = 'chat.start' as const;
    // @ts-expect-error — non-chat type must not satisfy ChatEvent['type']
    const _badProbe: ChatEvent['type'] = 'cook.start';
    expect(_typeProbe).toBe('chat.start');
    expect(_badProbe).toBe('cook.start');
  });
});
