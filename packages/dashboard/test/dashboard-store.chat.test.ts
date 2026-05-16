import type { LogEntry } from '@swt-labs/shared';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Plan 03-01 (milestone 12, Phase 03) — dashboard-store chat tests.
 *
 * Milestone 13 / Phase 01 — rewritten against the unified-log + top-level
 * chat-thread shape. Assertions read from `state.unifiedLog` (filtered to
 * chat-* entries) + the hoisted `chat_session_id` / `chatStreaming` /
 * `chatStatus` fields. The 14 tests cover:
 *
 *   1. startChat happy path (optimistic chat-user entry + chatStreaming on)
 *   2. startChat empty/whitespace guard
 *   3. startChat fetch-throws rollback (first turn — chat-user entry filtered out)
 *   4. chat.start adopts the optimistic '' chat_session_id + backfills entries
 *   5. chat.message_delta accumulation across 3 deltas (in-place update)
 *   6. chat.tool_call push
 *   7. chat.message_end seal (does NOT clear chatStreaming)
 *   8. chat.token_usage 6-field attach
 *   9. chat.error pushes chat-error LogEntry + status='error' + pushError
 *  10. chat.complete clears chatStreaming + status='done'
 *  11. chat.complete preserves status='error' when chat.error fired first
 *  12. clearChat wipes chat-* entries (preserves cook/init/system)
 *  13. multi-turn reuses chat_session_id in postChatStart args
 *  14. stale chat_session_id event silently dropped (no synthesis)
 *  15. applyEvent routes chat.* before other branches (no init./cook. side effects)
 */

const fetchSnapshotMock = vi.fn();
const postInitMock = vi.fn();
const postCommandMock = vi.fn();
const postUatCheckpointMock = vi.fn();
const fetchArtifactRenderedMock = vi.fn();
const postCookStartMock = vi.fn();
const postPromptRespondMock = vi.fn();
const openSseConnectionMock = vi.fn();
const fetchConfigMock = vi.fn();
const fetchDoctorMock = vi.fn();
const fetchDetectPhaseMock = vi.fn();
const fetchUpdateMock = vi.fn();
const fetchCommandsMock = vi.fn();
const postConfigMock = vi.fn();
const postUpdateApplyMock = vi.fn();
const fetchProviderAuthMock = vi.fn();
const postProviderAuthMock = vi.fn();
const fetchUserNotesMock = vi.fn();
const postUserNotesMock = vi.fn();
const postOAuthStartMock = vi.fn();
const postOAuthCodeMock = vi.fn();
const postChatStartMock = vi.fn();

vi.mock('../src/client/services/api.js', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  postInit: (...args: unknown[]) => postInitMock(...args),
  postCommand: (...args: unknown[]) => postCommandMock(...args),
  postUatCheckpoint: (...args: unknown[]) => postUatCheckpointMock(...args),
  fetchArtifactRendered: (...args: unknown[]) => fetchArtifactRenderedMock(...args),
  postCookStart: (...args: unknown[]) => postCookStartMock(...args),
  postPromptRespond: (...args: unknown[]) => postPromptRespondMock(...args),
  fetchConfig: (...args: unknown[]) => fetchConfigMock(...args),
  fetchDoctor: (...args: unknown[]) => fetchDoctorMock(...args),
  fetchDetectPhase: (...args: unknown[]) => fetchDetectPhaseMock(...args),
  fetchUpdate: (...args: unknown[]) => fetchUpdateMock(...args),
  fetchCommands: (...args: unknown[]) => fetchCommandsMock(...args),
  postConfig: (...args: unknown[]) => postConfigMock(...args),
  postUpdateApply: (...args: unknown[]) => postUpdateApplyMock(...args),
  fetchProviderAuth: (...args: unknown[]) => fetchProviderAuthMock(...args),
  postProviderAuth: (...args: unknown[]) => postProviderAuthMock(...args),
  fetchUserNotes: (...args: unknown[]) => fetchUserNotesMock(...args),
  postUserNotes: (...args: unknown[]) => postUserNotesMock(...args),
  postOAuthStart: (...args: unknown[]) => postOAuthStartMock(...args),
  postOAuthCode: (...args: unknown[]) => postOAuthCodeMock(...args),
  postChatStart: (...args: unknown[]) => postChatStartMock(...args),
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

import { createDashboardStore } from '../src/client/state/dashboard-store.js';

/**
 * Chat-lane filter — surface only chat-user / chat-assistant / chat-error
 * entries from `state.unifiedLog`. Mirrors the canonical `filterChatEntries`
 * helper (packages/dashboard/src/client/components/unified-log-helpers.ts)
 * inlined here to keep the test free of the helper-module import (so it
 * can be re-used by any future test that wants the filter without pulling
 * the panel surface).
 */
const chatEntries = (
  log: readonly LogEntry[],
): Array<Extract<LogEntry, { kind: 'chat-user' | 'chat-assistant' | 'chat-error' }>> =>
  log.filter(
    (e): e is Extract<LogEntry, { kind: 'chat-user' | 'chat-assistant' | 'chat-error' }> =>
      e.kind === 'chat-user' || e.kind === 'chat-assistant' || e.kind === 'chat-error',
  );

beforeEach(() => {
  postChatStartMock.mockReset();
  openSseConnectionMock.mockReset();
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('startChat action', () => {
  it('startChat happy path — optimistic chat-user entry + chatStreaming on', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const result = await actions.startChat('  hello world  ');
      // Returned id is the optimistic '' (chat.start has not arrived yet).
      expect(result).toBe('');
      // chatStarting cleared by finally block.
      expect(state.chatStarting).toBe(false);
      // Top-level fields adopted.
      expect(state.chat_session_id).toBe('');
      expect(state.chatStreaming).toBe(true);
      expect(state.chatStatus).toBe('streaming');
      // Optimistic chat-user entry pushed to the unified log.
      const chats = chatEntries(state.unifiedLog);
      expect(chats).toHaveLength(1);
      expect(chats[0]?.kind).toBe('chat-user');
      // Trim must have removed surrounding whitespace.
      if (chats[0]?.kind === 'chat-user') {
        expect(chats[0].text).toBe('hello world');
        // chat_session_id is the empty optimistic placeholder until chat.start lands.
        expect(chats[0].chat_session_id).toBe('');
      }
      // postChatStart called with trimmed prompt + undefined session id (first turn).
      expect(postChatStartMock).toHaveBeenCalledTimes(1);
      expect(postChatStartMock).toHaveBeenCalledWith('hello world', undefined);
      dispose();
    });
  });

  it('startChat empty/whitespace input returns null without calling postChatStart', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const result1 = await actions.startChat('');
      const result2 = await actions.startChat('   \t\n  ');
      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(state.chat_session_id).toBeNull();
      expect(state.chatStreaming).toBe(false);
      expect(state.chatStatus).toBe('idle');
      expect(chatEntries(state.unifiedLog)).toHaveLength(0);
      expect(state.chatStarting).toBe(false);
      expect(postChatStartMock).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('startChat error path (first turn) rolls back chat_session_id + filters chat-user entry', async () => {
    postChatStartMock.mockRejectedValueOnce(new Error('network down'));
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const result = await actions.startChat('hello');
      expect(result).toBeNull();
      // First-turn rollback: thread id back to null.
      expect(state.chat_session_id).toBeNull();
      expect(state.chatStreaming).toBe(false);
      expect(state.chatStatus).toBe('idle');
      // Orphan chat-user entry filtered out of unifiedLog.
      expect(chatEntries(state.unifiedLog)).toHaveLength(0);
      // pushError surfaced the failure.
      expect(state.errors.length).toBeGreaterThanOrEqual(1);
      expect(state.errors[state.errors.length - 1]?.message).toContain('chat start failed');
      // chatStarting cleared in finally even on error.
      expect(state.chatStarting).toBe(false);
      dispose();
    });
  });
});

describe('chat event reducer', () => {
  it('chat.start adopts the optimistic chat_session_id + backfills entries', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('hi');
      expect(state.chat_session_id).toBe('');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'abc-123',
        prompt: 'hi',
      });
      expect(state.chat_session_id).toBe('abc-123');
      // The optimistic chat-user entry's chat_session_id has been backfilled.
      const chats = chatEntries(state.unifiedLog);
      expect(chats[0]?.chat_session_id).toBe('abc-123');
      dispose();
    });
  });

  it('chat.message_delta accumulates text across multiple deltas (in-place update)', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('hello');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-A',
        prompt: 'hello',
      });
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'sess-A',
        text: 'Hi ',
      });
      const lengthAfterFirstDelta = chatEntries(state.unifiedLog).length;
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:02Z',
        chat_session_id: 'sess-A',
        text: 'there, ',
      });
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:03Z',
        chat_session_id: 'sess-A',
        text: 'friend!',
      });
      const chats = chatEntries(state.unifiedLog);
      // In-place update — length unchanged after the 2nd + 3rd deltas.
      expect(chats).toHaveLength(lengthAfterFirstDelta);
      const last = chats[chats.length - 1];
      expect(last?.kind).toBe('chat-assistant');
      if (last?.kind === 'chat-assistant') {
        expect(last.text).toBe('Hi there, friend!');
        expect(last.completed).toBe(false);
      }
      // User message is still the first chat entry.
      expect(chats[0]?.kind).toBe('chat-user');
      dispose();
    });
  });

  it('chat.tool_call appends tool name to last assistant entry tools_called[]', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('use tools');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-B',
        prompt: 'use tools',
      });
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'sess-B',
        text: 'reading…',
      });
      actions.applyEvent({
        type: 'chat.tool_call',
        ts: '2026-05-16T10:00:02Z',
        chat_session_id: 'sess-B',
        tool: 'read_file',
      });
      actions.applyEvent({
        type: 'chat.tool_call',
        ts: '2026-05-16T10:00:03Z',
        chat_session_id: 'sess-B',
        tool: 'grep',
      });
      const chats = chatEntries(state.unifiedLog);
      const last = chats[chats.length - 1];
      expect(last?.kind).toBe('chat-assistant');
      if (last?.kind === 'chat-assistant') {
        expect(last.tools_called).toEqual(['read_file', 'grep']);
      }
      dispose();
    });
  });

  it('chat.message_end seals last assistant entry (completed=true) but does NOT clear chatStreaming', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('seal me');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-C',
        prompt: 'seal me',
      });
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'sess-C',
        text: 'done',
      });
      actions.applyEvent({
        type: 'chat.message_end',
        ts: '2026-05-16T10:00:02Z',
        chat_session_id: 'sess-C',
      });
      const chats = chatEntries(state.unifiedLog);
      const last = chats[chats.length - 1];
      if (last?.kind === 'chat-assistant') {
        expect(last.completed).toBe(true);
      }
      // chatStreaming is owned by chat.complete — message_end alone leaves it on.
      expect(state.chatStreaming).toBe(true);
      dispose();
    });
  });

  it('chat.token_usage attaches the 6-field usage payload to the last assistant entry', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('count tokens');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-D',
        prompt: 'count tokens',
      });
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'sess-D',
        text: 'reply',
      });
      actions.applyEvent({
        type: 'chat.token_usage',
        ts: '2026-05-16T10:00:02Z',
        chat_session_id: 'sess-D',
        input: 123,
        output: 456,
        cacheRead: 12,
        cacheWrite: 7,
        provider: 'anthropic',
        model: 'claude-opus-4-7',
      });
      const chats = chatEntries(state.unifiedLog);
      const last = chats[chats.length - 1];
      if (last?.kind === 'chat-assistant') {
        expect(last.usage).toEqual({
          input: 123,
          output: 456,
          cacheRead: 12,
          cacheWrite: 7,
          provider: 'anthropic',
          model: 'claude-opus-4-7',
        });
      }
      dispose();
    });
  });

  it('chat.error pushes a chat-error LogEntry + flips chatStatus to error + pushError', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('explode');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-E',
        prompt: 'explode',
      });
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'sess-E',
        text: 'partial',
      });
      const errorsBefore = state.errors.length;
      actions.applyEvent({
        type: 'chat.error',
        ts: '2026-05-16T10:00:02Z',
        chat_session_id: 'sess-E',
        code: 'CHAT_SESSION_ERROR',
        message: 'pi blew up',
      });
      const chats = chatEntries(state.unifiedLog);
      const errors = chats.filter((e) => e.kind === 'chat-error');
      expect(errors).toHaveLength(1);
      const err = errors[0];
      if (err?.kind === 'chat-error') {
        expect(err.code).toBe('CHAT_SESSION_ERROR');
        expect(err.message).toBe('pi blew up');
      }
      expect(state.chatStatus).toBe('error');
      // pushError fired for global visibility.
      expect(state.errors.length).toBeGreaterThan(errorsBefore);
      expect(state.errors[state.errors.length - 1]?.message).toContain('chat error');
      expect(state.errors[state.errors.length - 1]?.message).toContain('CHAT_SESSION_ERROR');
      dispose();
    });
  });

  it('chat.complete clears chatStreaming + sets chatStatus to done (no prior error)', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('finish');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-F',
        prompt: 'finish',
      });
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'sess-F',
        text: 'all good',
      });
      actions.applyEvent({
        type: 'chat.message_end',
        ts: '2026-05-16T10:00:02Z',
        chat_session_id: 'sess-F',
      });
      actions.applyEvent({
        type: 'chat.complete',
        ts: '2026-05-16T10:00:03Z',
        chat_session_id: 'sess-F',
      });
      expect(state.chatStreaming).toBe(false);
      expect(state.chatStatus).toBe('done');
      dispose();
    });
  });

  it('chat.complete preserves chatStatus=error when chat.error fired first in the same turn', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('break then close');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-G',
        prompt: 'break then close',
      });
      actions.applyEvent({
        type: 'chat.error',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'sess-G',
        code: 'CHAT_PROMPT_ERROR',
        message: 'oops',
      });
      actions.applyEvent({
        type: 'chat.complete',
        ts: '2026-05-16T10:00:02Z',
        chat_session_id: 'sess-G',
      });
      expect(state.chatStreaming).toBe(false);
      // chatStatus preserved as 'error', NOT overwritten to 'done'.
      expect(state.chatStatus).toBe('error');
      dispose();
    });
  });

  it('stale chat_session_id event is silently dropped (no synthesis)', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('correlate');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'real-id',
        prompt: 'correlate',
      });
      const beforeChats = chatEntries(state.unifiedLog);
      // Stale delta from a different (or stale-tab) session.
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'wrong-id',
        text: 'should be dropped',
      });
      const afterChats = chatEntries(state.unifiedLog);
      // Strict equality on length + content (no synthesis happened).
      expect(afterChats).toHaveLength(beforeChats.length);
      // None of the entries should contain the dropped text.
      expect(
        afterChats.every((m) =>
          m.kind === 'chat-assistant' ? !m.text.includes('should be dropped') : true,
        ),
      ).toBe(true);
      dispose();
    });
  });
});

describe('clearChat action', () => {
  it('clearChat wipes chat-* entries + resets thread fields (preserves cook/init/system)', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      // Seed a system + init + cook entry alongside the chat thread so we
      // can prove clearChat preserves them.
      actions.applyEvent({
        type: 'log.append',
        ts: '2026-05-16T10:00:00Z',
        channel: 'stdout',
        line: 'pre-existing system line',
      });
      actions.applyEvent({
        type: 'init.start',
        ts: '2026-05-16T10:00:00Z',
        session_id: 'init-1',
      });
      await actions.startChat('something');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-H',
        prompt: 'something',
      });
      expect(state.chat_session_id).toBe('sess-H');
      expect(chatEntries(state.unifiedLog).length).toBeGreaterThan(0);
      const nonChatBefore = state.unifiedLog.filter(
        (e) => e.kind !== 'chat-user' && e.kind !== 'chat-assistant' && e.kind !== 'chat-error',
      ).length;
      actions.clearChat();
      // Chat-* entries gone.
      expect(chatEntries(state.unifiedLog)).toHaveLength(0);
      // Thread fields reset.
      expect(state.chat_session_id).toBeNull();
      expect(state.chatStreaming).toBe(false);
      expect(state.chatStatus).toBe('idle');
      // Non-chat entries preserved (the clearChat breadcrumb adds one new
      // system-internal entry, so the count goes up by exactly 1).
      const nonChatAfter = state.unifiedLog.filter(
        (e) => e.kind !== 'chat-user' && e.kind !== 'chat-assistant' && e.kind !== 'chat-error',
      ).length;
      expect(nonChatAfter).toBe(nonChatBefore + 1);
      dispose();
    });
  });
});

describe('multi-turn semantics', () => {
  it('multi-turn startChat passes the existing chat_session_id to postChatStart', async () => {
    postChatStartMock.mockResolvedValue(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      // Turn 1 — first call.
      await actions.startChat('turn 1');
      expect(postChatStartMock).toHaveBeenNthCalledWith(1, 'turn 1', undefined);
      // chat.start adopts a real session id.
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'multi-id',
        prompt: 'turn 1',
      });
      // Seal turn 1 so multi-turn flips streaming back to on.
      actions.applyEvent({
        type: 'chat.complete',
        ts: '2026-05-16T10:00:05Z',
        chat_session_id: 'multi-id',
      });
      // Turn 2 — second call reuses the id.
      await actions.startChat('turn 2');
      expect(postChatStartMock).toHaveBeenNthCalledWith(2, 'turn 2', 'multi-id');
      // unifiedLog grew by one chat-user entry (turn 2's user message).
      const userMsgs = chatEntries(state.unifiedLog).filter((e) => e.kind === 'chat-user');
      expect(userMsgs).toHaveLength(2);
      const t2 = userMsgs[1];
      if (t2?.kind === 'chat-user') {
        expect(t2.text).toBe('turn 2');
      }
      // chatStreaming + chatStatus flipped back to in-progress.
      expect(state.chatStreaming).toBe(true);
      expect(state.chatStatus).toBe('streaming');
      dispose();
    });
  });
});

describe('applyEvent routing precedence', () => {
  it('chat.* events do not trigger init./cook./oauth. side effects', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      // No chat thread set — chat.start should be silently dropped.
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'orphan',
        prompt: 'no session',
      });
      // Sanity: thread id remains null, none of the other slots changed.
      expect(state.chat_session_id).toBeNull();
      expect(state.initSession).toBeNull();
      expect(state.vibeSession).toBeNull();
      expect(state.oauthFlow).toBeNull();
      expect(state.activeAgents.size).toBe(0);
      expect(state.activeSessionId).toBeNull();
      dispose();
    });
  });
});
