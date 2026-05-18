/**
 * Milestone 13 / Phase 01 — `unified-log-helpers` coverage.
 *
 * Mirrors the `chat-panel.test.ts` precedent: node-env vitest, no DOM, no
 * Solid imports. The five pure helpers (named per ROADMAP success criterion
 * #7) are exercised with ≥ 2 cases each — minimum 10, current count 21.
 */

import type { LogEntry } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  classifyEntry,
  entryToLine,
  filterChatEntries,
  formatTimestamp,
  shouldDisableClear,
} from '../src/client/components/unified-log-helpers.js';

const TS = '2026-05-16T14:23:45.123Z';

const initEntry: LogEntry = {
  kind: 'init',
  id: 'log-init-1',
  ts: TS,
  session_id: 'init-1',
  status: 'start',
  message: 'Lead detecting stack…',
};

const cookStatusStarted: LogEntry = {
  kind: 'cook-status',
  id: 'log-cook-1',
  ts: TS,
  session_id: 'cook-1',
  subtype: 'started',
  message: 'started session 12345678 — "fix the bug"',
};

const cookToolCall: LogEntry = {
  kind: 'cook-tool',
  id: 'log-tool-1',
  ts: TS,
  session_id: 'cook-1',
  sub_session_id: 'sub-abcd1234',
  tool: 'Read',
  event: 'call',
  input_excerpt: 'packages/shared/src/types/log-entry.ts',
};

const cookAgentSpawn: LogEntry = {
  kind: 'cook-agent',
  id: 'log-agent-1',
  ts: TS,
  session_id: 'cook-1',
  sub_session_id: 'sub-abcd1234',
  role: 'dev',
  event: 'spawn',
};

const cookAskUser: LogEntry = {
  kind: 'cook-ask-user',
  id: 'log-ask-1',
  ts: TS,
  session_id: 'cook-1',
  prompt_id: 'prompt-1',
  question: 'Which migration strategy?',
  status: 'pending',
};

// Phase 17 plan 04-01 Task 4 — Codex parity update_plan render fixture.
// Three-item plan exercises all three status glyphs ([x] completed,
// [~] in_progress, [ ] pending) in one assertion.
const cookPlanUpdate: LogEntry = {
  kind: 'cook-plan-update',
  id: 'log-plan-1',
  ts: TS,
  session_id: 'cook-1',
  sub_session_id: 'sub-abcd1234',
  plan: [
    { step: 'load context', status: 'completed' },
    { step: 'edit code', status: 'in_progress' },
    { step: 'run tests', status: 'pending' },
  ],
};

const cookPlanUpdateWithExplanation: LogEntry = {
  kind: 'cook-plan-update',
  id: 'log-plan-2',
  ts: TS,
  session_id: 'cook-1',
  sub_session_id: 'sub-abcd1234',
  plan: [{ step: 'pick approach', status: 'in_progress' }],
  explanation: 'evaluating option A vs option B',
};

const cookPlanUpdateEmpty: LogEntry = {
  kind: 'cook-plan-update',
  id: 'log-plan-3',
  ts: TS,
  session_id: 'cook-1',
  sub_session_id: 'sub-abcd1234',
  plan: [],
};

const chatUser: LogEntry = {
  kind: 'chat-user',
  id: 'chat-msg-1',
  ts: TS,
  chat_session_id: 'chat-1',
  text: 'hi',
};

const chatAssistant: LogEntry = {
  kind: 'chat-assistant',
  id: 'chat-msg-2',
  ts: TS,
  chat_session_id: 'chat-1',
  text: 'hello back',
  completed: true,
};

const chatError: LogEntry = {
  kind: 'chat-error',
  id: 'chat-err-1',
  ts: TS,
  chat_session_id: 'chat-1',
  code: 'CHAT_AUTH_FAILED',
  message: 'No credential available',
};

const systemInternal: LogEntry = {
  kind: 'system',
  id: 'log-system-1',
  ts: TS,
  channel: 'internal',
  line: '[chat] conversation cleared',
};

const systemStdout: LogEntry = {
  kind: 'system',
  id: 'log-system-2',
  ts: TS,
  channel: 'stdout',
  line: 'Running migrations…',
};

describe('classifyEntry', () => {
  it('routes chat-user / chat-assistant / chat-error to the chat lane', () => {
    expect(classifyEntry(chatUser)).toBe('chat');
    expect(classifyEntry(chatAssistant)).toBe('chat');
    expect(classifyEntry(chatError)).toBe('chat');
  });

  it('routes cook-status / cook-agent / cook-tool / cook-ask-user to the cook lane', () => {
    expect(classifyEntry(cookStatusStarted)).toBe('cook');
    expect(classifyEntry(cookAgentSpawn)).toBe('cook');
    expect(classifyEntry(cookToolCall)).toBe('cook');
    expect(classifyEntry(cookAskUser)).toBe('cook');
  });

  it('routes cook-plan-update to the cook lane (Phase 17 plan 04-01 — Codex parity)', () => {
    expect(classifyEntry(cookPlanUpdate)).toBe('cook');
    expect(classifyEntry(cookPlanUpdateWithExplanation)).toBe('cook');
    expect(classifyEntry(cookPlanUpdateEmpty)).toBe('cook');
  });

  it('routes init entries to the init lane and system entries to the system lane', () => {
    expect(classifyEntry(initEntry)).toBe('init');
    expect(classifyEntry(systemInternal)).toBe('system');
    expect(classifyEntry(systemStdout)).toBe('system');
  });
});

describe('formatTimestamp', () => {
  it("slices an ISO-8601 timestamp to 'HH:MM:SS'", () => {
    expect(formatTimestamp('2026-05-16T14:23:45.123Z')).toBe('14:23:45');
  });

  it('returns empty string for input shorter than 19 chars', () => {
    expect(formatTimestamp('not-a-ts')).toBe('');
    expect(formatTimestamp('')).toBe('');
  });

  it('returns empty string when the separator at index 10 is not T', () => {
    // Same length as a real ISO-8601 string but with a space separator.
    expect(formatTimestamp('2026-05-16 14:23:45.123Z')).toBe('');
  });
});

describe('entryToLine', () => {
  it('renders an init entry as `HH:MM:SS [init] message`', () => {
    expect(entryToLine(initEntry)).toBe('14:23:45 [init] Lead detecting stack…');
  });

  it('renders a cook-status started entry with the message body inline', () => {
    expect(entryToLine(cookStatusStarted)).toBe(
      '14:23:45 [cook] started session 12345678 — "fix the bug"',
    );
  });

  it('renders a cook-tool call entry with the tool name + input excerpt', () => {
    expect(entryToLine(cookToolCall)).toBe(
      '14:23:45 [cook] tool: Read packages/shared/src/types/log-entry.ts',
    );
  });

  it('renders a system internal entry with the [internal] tag', () => {
    expect(entryToLine(systemInternal)).toBe(
      '14:23:45 [system] [internal] [chat] conversation cleared',
    );
  });

  it('renders a system stdout entry without the [internal] tag', () => {
    expect(entryToLine(systemStdout)).toBe('14:23:45 [system] Running migrations…');
  });

  it('renders a chat-error entry with code: message format', () => {
    expect(entryToLine(chatError)).toBe(
      '14:23:45 [chat-error] CHAT_AUTH_FAILED: No credential available',
    );
  });

  it('renders a chat-assistant entry with tools_called as an inline [tool: …] suffix', () => {
    const assistantWithTools: LogEntry = {
      kind: 'chat-assistant',
      id: 'chat-msg-tools',
      ts: TS,
      chat_session_id: 'chat-1',
      text: 'message',
      completed: true,
      tools_called: ['Read', 'Write'],
    };
    expect(entryToLine(assistantWithTools)).toBe(
      '14:23:45 [chat-assistant] message [tool: Read, tool: Write]',
    );
  });

  it('renders a chat-assistant entry with usage as a `↑in ↓out` suffix', () => {
    const assistantWithUsage: LogEntry = {
      kind: 'chat-assistant',
      id: 'chat-msg-usage',
      ts: TS,
      chat_session_id: 'chat-1',
      text: 'message',
      completed: true,
      usage: {
        input: 12,
        output: 34,
        cacheRead: 0,
        cacheWrite: 0,
        provider: 'anthropic',
        model: 'claude',
      },
    };
    expect(entryToLine(assistantWithUsage)).toBe('14:23:45 [chat-assistant] message ↑12 ↓34');
  });

  it('renders cook-plan-update with [x]/[~]/[ ] glyphs for mixed-status plan items', () => {
    const line = entryToLine(cookPlanUpdate);
    // All three glyphs are present.
    expect(line).toContain('[x]');
    expect(line).toContain('[~]');
    expect(line).toContain('[ ]');
    // [cook] lane prefix and `plan:` literal anchor.
    expect(line).toContain('[cook] plan:');
    // ` | ` is the inter-item separator.
    expect(line).toContain(' | ');
    // Full canonical line shape matches milestone-16 monospace
    // discipline: `HH:MM:SS [cook] plan: [x] step1 | [~] step2 | [ ] step3`.
    expect(line).toBe('14:23:45 [cook] plan: [x] load context | [~] edit code | [ ] run tests');
  });

  it('renders cook-plan-update with an empty plan as `plan: ` followed by no items', () => {
    expect(entryToLine(cookPlanUpdateEmpty)).toBe('14:23:45 [cook] plan: ');
  });

  it('renders cook-plan-update with explanation appended as ` — <text>`', () => {
    expect(entryToLine(cookPlanUpdateWithExplanation)).toBe(
      '14:23:45 [cook] plan: [~] pick approach — evaluating option A vs option B',
    );
  });

  it('renders a chat-assistant entry with both tools_called and usage folded into the same line', () => {
    const assistantBoth: LogEntry = {
      kind: 'chat-assistant',
      id: 'chat-msg-both',
      ts: TS,
      chat_session_id: 'chat-1',
      text: 'message',
      completed: true,
      tools_called: ['Read'],
      usage: {
        input: 12,
        output: 34,
        cacheRead: 0,
        cacheWrite: 0,
        provider: 'anthropic',
        model: 'claude',
      },
    };
    expect(entryToLine(assistantBoth)).toBe(
      '14:23:45 [chat-assistant] message [tool: Read] ↑12 ↓34',
    );
  });
});

describe('filterChatEntries', () => {
  it('returns only the chat-lane entries from a mixed array, preserving order', () => {
    const mixed: LogEntry[] = [
      initEntry,
      chatUser,
      cookStatusStarted,
      chatAssistant,
      systemInternal,
      chatError,
    ];
    expect(filterChatEntries(mixed)).toEqual([chatUser, chatAssistant, chatError]);
  });

  it('returns an empty array when there are no chat entries', () => {
    expect(filterChatEntries([initEntry, cookStatusStarted, systemInternal])).toEqual([]);
  });

  it('returns an empty array for an empty input array', () => {
    expect(filterChatEntries([])).toEqual([]);
  });

  it('excludes cook-plan-update from chat-lane filtering (Phase 17 plan 04-01)', () => {
    expect(filterChatEntries([cookPlanUpdate])).toEqual([]);
  });
});

describe('shouldDisableClear', () => {
  it('disables the button when the log is empty (nothing to clear)', () => {
    expect(shouldDisableClear([], false)).toBe(true);
  });

  it('disables the button while a chat turn is streaming, even if chat entries exist', () => {
    expect(shouldDisableClear([chatUser], true)).toBe(true);
  });

  it('enables the button when chat entries exist and no stream is in flight', () => {
    expect(shouldDisableClear([chatUser, chatAssistant], false)).toBe(false);
  });

  it('disables the button when only non-chat entries exist (nothing chat-shaped to clear)', () => {
    expect(shouldDisableClear([initEntry, cookStatusStarted, systemInternal], false)).toBe(true);
  });

  it('disables the button when only cook-plan-update entries exist (cook lane is not chat)', () => {
    expect(shouldDisableClear([cookPlanUpdate], false)).toBe(true);
  });
});
