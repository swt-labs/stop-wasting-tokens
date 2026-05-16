/**
 * alpha.21 — `mapPiEvent` regression tests.
 *
 * Covers two contract additions:
 *
 *   1. **TASK_ERROR for stopReason='error' turn_ends.** Pi keeps upstream
 *      API failures (out-of-credits, invalid-request, rate-limit, network)
 *      on `message.errorMessage` rather than throwing from
 *      `agentSession.prompt()`. The mapper must surface this as
 *      `TASK_ERROR` so the dispatcher can translate the silent no-op into
 *      `TaskResult.status='failed'` — closes the cook-orchestrator no-op
 *      that returned `cook.agent_result status="completed"` with zero
 *      tokens on a failed-upstream LLM call.
 *
 *   2. **Provider/model fall back to `message.<field>`.** Pi populates
 *      `provider` + `model` on the assistant message envelope, not at the
 *      event root. The pre-alpha.21 mapper read `event.provider`
 *      exclusively → defaulted to `'unknown'` → extractor dispatch failed.
 */

import { describe, expect, it } from 'vitest';

import { mapPiEvent } from '../src/events.js';

const SID = 'test-session-id';

describe('@swt-labs/runtime — mapPiEvent.turn_end TASK_ERROR (alpha.21 Bug C)', () => {
  it('emits TASK_ERROR when stopReason="error" + errorMessage is populated', () => {
    const piEvent = {
      type: 'turn_end',
      turn: 1,
      message: {
        role: 'assistant',
        content: [],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        stopReason: 'error',
        errorMessage:
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage."}}',
      },
    };
    const mapped = mapPiEvent(piEvent, SID);
    expect(mapped).toEqual({
      type: 'TASK_ERROR',
      sessionId: SID,
      errorMessage: piEvent.message.errorMessage,
    });
  });

  it('falls back to a generic message when stopReason="error" but errorMessage is missing', () => {
    const piEvent = {
      type: 'turn_end',
      turn: 1,
      message: {
        content: [],
        stopReason: 'error',
        // errorMessage omitted — should still surface something
      },
    };
    const mapped = mapPiEvent(piEvent, SID);
    expect(mapped?.type).toBe('TASK_ERROR');
    if (mapped?.type === 'TASK_ERROR') {
      expect(mapped.errorMessage).toContain('stopReason=error');
    }
  });

  it('does NOT emit TASK_TOKEN_USAGE on error turns (avoids polluting cost accounting with estimates)', () => {
    // Pi's withUsageEstimate fallback fires on error turns and produces
    // synthetic camelCase usage that is NOT billable. Don't meter it.
    const piEvent = {
      type: 'turn_end',
      turn: 1,
      message: {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        stopReason: 'error',
        errorMessage: '400 invalid_request',
        // Synthetic estimate Pi populates on error — we must IGNORE this.
        usage: { input: 12345, output: 67890, cacheRead: 0, cacheWrite: 0 },
      },
    };
    const mapped = mapPiEvent(piEvent, SID);
    expect(mapped?.type).toBe('TASK_ERROR');
  });

  it('happy-path stopReason="end_turn" still produces TASK_TOKEN_USAGE', () => {
    const piEvent = {
      type: 'turn_end',
      turn: 1,
      message: {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        stopReason: 'end_turn',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
        },
      },
    };
    const mapped = mapPiEvent(piEvent, SID);
    expect(mapped?.type).toBe('TASK_TOKEN_USAGE');
    if (mapped?.type === 'TASK_TOKEN_USAGE') {
      expect(mapped.usage.input).toBe(100);
      expect(mapped.usage.output).toBe(50);
      expect(mapped.usage.cacheRead).toBe(20);
      expect(mapped.usage.cacheWrite).toBe(10);
    }
  });
});

describe('@swt-labs/runtime — mapPiEvent.turn_end provider/model fallback (alpha.21)', () => {
  it('reads provider+model from message envelope when missing from event root', () => {
    // Pre-alpha.21 path: provider stayed `'unknown'` → extractor dispatched
    // to generic → camelCase Pi usage was ignored. alpha.21 reads from
    // message envelope first so the real provider wins.
    const piEvent = {
      type: 'turn_end',
      turn: 1,
      message: {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        usage: {
          input_tokens: 42,
          output_tokens: 7,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    };
    const mapped = mapPiEvent(piEvent, SID);
    expect(mapped?.type).toBe('TASK_TOKEN_USAGE');
    if (mapped?.type === 'TASK_TOKEN_USAGE') {
      expect(mapped.usage.provider).toBe('anthropic');
      expect(mapped.usage.model).toBe('claude-opus-4-7');
      expect(mapped.usage.input).toBe(42);
    }
  });

  it('message-envelope provider wins over event-root provider when both are present', () => {
    // Pi 0.74 populates `provider`/`model` on `message`; the older PR-07
    // event-root path stays as a fallback for adapter shapes that emit
    // there. When both exist the envelope is authoritative.
    const piEvent = {
      type: 'turn_end',
      turn: 1,
      provider: 'fallback-event-root',
      model: 'fallback-event-root',
      message: {
        provider: 'authoritative-message-envelope',
        model: 'authoritative-message-envelope',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    };
    const mapped = mapPiEvent(piEvent, SID);
    expect(mapped?.type).toBe('TASK_TOKEN_USAGE');
    if (mapped?.type === 'TASK_TOKEN_USAGE') {
      expect(mapped.usage.provider).toBe('authoritative-message-envelope');
      expect(mapped.usage.model).toBe('authoritative-message-envelope');
    }
  });
});

describe('@swt-labs/runtime — mapPiEvent.message_update MESSAGE_DELTA (alpha.25)', () => {
  it('emits MESSAGE_DELTA for assistantMessageEvent.type==="text_delta"', () => {
    // Pi 0.74's actual shape — text deltas live on `assistantMessageEvent`
    // (a discriminated union from `@earendil-works/pi-ai`'s
    // `AssistantMessageEvent`). The pre-alpha.25 mapper read from a
    // non-existent `event.delta.text` path and dropped every chunk, so
    // the dashboard chat panel rendered empty assistant bubbles.
    const piEvent = {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hello, ',
      },
    };
    const mapped = mapPiEvent(piEvent, SID);
    expect(mapped).toEqual({ type: 'MESSAGE_DELTA', sessionId: SID, text: 'Hello, ' });
  });

  it('returns undefined for assistantMessageEvent.type==="thinking_delta" (CoT bleed-through guard)', () => {
    // We intentionally do NOT surface chain-of-thought to the chat UI.
    const piEvent = {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'thinking_delta',
        contentIndex: 0,
        delta: 'internal reasoning...',
      },
    };
    expect(mapPiEvent(piEvent, SID)).toBeUndefined();
  });

  it('returns undefined for assistantMessageEvent.type==="toolcall_delta"', () => {
    // The orchestrator's tool_execution_start path emits a single
    // TOOL_CALL when the tool fully arrives — fragmentary toolcall_delta
    // arg chunks would just be noise.
    const piEvent = {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_delta',
        contentIndex: 0,
        delta: '{"file":"',
      },
    };
    expect(mapPiEvent(piEvent, SID)).toBeUndefined();
  });

  it('returns undefined for legacy `event.delta.text` shape (regression guard against the original bug)', () => {
    // If this test ever fails it means someone re-wired the old broken
    // shape. The current mapper MUST only honour the new path.
    const piEvent = {
      type: 'message_update',
      delta: { text: 'partial response' },
    };
    expect(mapPiEvent(piEvent, SID)).toBeUndefined();
  });

  it('returns undefined when assistantMessageEvent is absent', () => {
    const piEvent = { type: 'message_update' };
    expect(mapPiEvent(piEvent, SID)).toBeUndefined();
  });

  it('returns undefined when assistantMessageEvent.delta is not a string', () => {
    const piEvent = {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 42 },
    };
    expect(mapPiEvent(piEvent, SID)).toBeUndefined();
  });
});
