/**
 * Milestone 13 / Phase 01 — LogEntry Zod schema coverage.
 *
 * Round-trip parse one minimal payload per kind (9 cases), plus negative
 * cases (unknown kind, missing discriminant), plus an explicit budget_exceeded
 * coverage case proving Scout Cross-Cutting Finding #1 (previously-invisible
 * surface).
 */

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { LogEntrySchema, type CookStatusEntry, type LogEntry } from '../src/types/log-entry.js';

describe('@swt-labs/shared — LogEntrySchema', () => {
  it('parses an init entry (status: start)', () => {
    const payload: LogEntry = {
      kind: 'init',
      id: 'log-init-1',
      ts: '2026-05-16T14:23:45.123Z',
      session_id: 'init-abcd1234',
      status: 'start',
      message: '[init] Lead detecting stack…',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a cook-status entry (subtype: started)', () => {
    const payload: LogEntry = {
      kind: 'cook-status',
      id: 'log-cook-1',
      ts: '2026-05-16T14:24:00.000Z',
      session_id: 'cook-12345678',
      subtype: 'started',
      message: '[cook] started session 12345678 — "fix the bug"',
      mode: 'autonomous',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a cook-status entry with subtype: budget_exceeded (Cross-Cutting Finding #1)', () => {
    const payload: CookStatusEntry = {
      kind: 'cook-status',
      id: 'log-cook-budget-1',
      ts: '2026-05-16T14:30:00.000Z',
      session_id: 'cook-12345678',
      subtype: 'budget_exceeded',
      message: '[cook] budget exceeded — auto-pausing session',
    };
    const parsed = LogEntrySchema.parse(payload);
    expect(parsed).toEqual(payload);
    // Narrowing on `kind` gives access to subtype for the regression assertion.
    if (parsed.kind === 'cook-status') {
      expect(parsed.subtype).toBe('budget_exceeded');
    }
  });

  it('parses a cook-status entry with subtype: budget_resume', () => {
    const payload: LogEntry = {
      kind: 'cook-status',
      id: 'log-cook-budget-2',
      ts: '2026-05-16T14:31:00.000Z',
      session_id: 'cook-12345678',
      subtype: 'budget_resume',
      message: '[cook] budget refilled — session resumed',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a cook-agent spawn entry', () => {
    const payload: LogEntry = {
      kind: 'cook-agent',
      id: 'log-agent-1',
      ts: '2026-05-16T14:24:05.000Z',
      session_id: 'cook-12345678',
      sub_session_id: 'sub-abcd1234',
      role: 'dev',
      event: 'spawn',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a cook-agent result entry with cost + elapsed', () => {
    const payload: LogEntry = {
      kind: 'cook-agent',
      id: 'log-agent-2',
      ts: '2026-05-16T14:25:00.000Z',
      session_id: 'cook-12345678',
      sub_session_id: 'sub-abcd1234',
      role: 'dev',
      event: 'result',
      result_status: 'completed',
      cost_usd: 0.0123,
      elapsed_ms: 45000,
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a cook-tool call entry', () => {
    const payload: LogEntry = {
      kind: 'cook-tool',
      id: 'log-tool-1',
      ts: '2026-05-16T14:24:10.000Z',
      session_id: 'cook-12345678',
      sub_session_id: 'sub-abcd1234',
      tool: 'Read',
      event: 'call',
      input_excerpt: 'packages/shared/src/types/log-entry.ts',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a cook-ask-user entry (Phase 01 declares shape, Phase 02 populates)', () => {
    const payload: LogEntry = {
      kind: 'cook-ask-user',
      id: 'log-ask-1',
      ts: '2026-05-16T14:24:15.000Z',
      session_id: 'cook-12345678',
      prompt_id: 'prompt-abcd1234',
      question: 'Which migration strategy?',
      options: [
        { value: 'soft', label: 'Soft delete' },
        { value: 'hard', label: 'Hard delete', description: 'Permanent' },
      ],
      status: 'pending',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a chat-user entry', () => {
    const payload: LogEntry = {
      kind: 'chat-user',
      id: 'chat-msg-1',
      ts: '2026-05-16T14:25:00.000Z',
      chat_session_id: 'chat-abcd1234',
      text: 'hi',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a chat-assistant entry mid-stream (completed=false)', () => {
    const payload: LogEntry = {
      kind: 'chat-assistant',
      id: 'chat-msg-2',
      ts: '2026-05-16T14:25:01.000Z',
      chat_session_id: 'chat-abcd1234',
      text: 'partial response…',
      completed: false,
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a chat-error entry with the closed-enum code set', () => {
    const payload: LogEntry = {
      kind: 'chat-error',
      id: 'chat-err-1',
      ts: '2026-05-16T14:25:02.000Z',
      chat_session_id: 'chat-abcd1234',
      code: 'CHAT_AUTH_FAILED',
      message: 'No credential available for provider anthropic',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a system entry with channel: internal (Scout §1 K-3 new discriminator)', () => {
    const payload: LogEntry = {
      kind: 'system',
      id: 'log-system-1',
      ts: '2026-05-16T14:25:03.000Z',
      channel: 'internal',
      line: '[chat] conversation cleared',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('parses a system entry with channel: stdout from a log.append SSE event', () => {
    const payload: LogEntry = {
      kind: 'system',
      id: 'log-system-2',
      ts: '2026-05-16T14:25:04.000Z',
      channel: 'stdout',
      line: 'Running migrations…',
    };
    expect(LogEntrySchema.parse(payload)).toEqual(payload);
  });

  it('rejects an unknown kind value with a ZodError', () => {
    expect(() =>
      LogEntrySchema.parse({
        kind: 'bogus',
        id: 'x',
        ts: 'x',
      }),
    ).toThrow(ZodError);
  });

  it('rejects a payload missing the discriminant `kind` field', () => {
    expect(() =>
      LogEntrySchema.parse({
        id: 'x',
        ts: 'x',
      }),
    ).toThrow(ZodError);
  });

  it('rejects a chat-error entry with an off-enum code', () => {
    expect(() =>
      LogEntrySchema.parse({
        kind: 'chat-error',
        id: 'x',
        ts: 'x',
        chat_session_id: 'x',
        code: 'CHAT_TOTALLY_MADE_UP',
        message: 'x',
      }),
    ).toThrow(ZodError);
  });

  it('rejects a system entry with an off-enum channel', () => {
    expect(() =>
      LogEntrySchema.parse({
        kind: 'system',
        id: 'x',
        ts: 'x',
        channel: 'nonsense',
        line: 'x',
      }),
    ).toThrow(ZodError);
  });
});
