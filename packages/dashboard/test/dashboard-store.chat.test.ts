import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Plan 03-01 (milestone 12, Phase 03) — dashboard-store chat tests.
 *
 * Mirrors `dashboard-store-cook-events.test.ts`'s pattern: mock the API +
 * SSE modules at the top, invoke `applyEvent` directly to simulate the
 * /api/events bus channel, no DOM or jsdom (environment is 'node').
 *
 * The 15 tests cover:
 *   1. startChat happy path (optimistic state + chatStarting flag)
 *   2. startChat empty/whitespace guard
 *   3. startChat fetch-throws rollback (first turn)
 *   4. chat.start adopts the optimistic '' chat_session_id
 *   5. chat.message_delta accumulation across 3 deltas
 *   6. chat.tool_call push
 *   7. chat.message_end seal (does NOT clear streaming)
 *   8. chat.token_usage 6-field attach
 *   9. chat.error attach + status='error' + pushError
 *  10. chat.complete clears streaming + status='done'
 *  11. chat.complete preserves status='error' when chat.error fired first
 *  12. clearChat wipes session
 *  13. multi-turn reuses chat_session_id in postChatStart args
 *  14. stale chat_session_id event silently dropped
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
  it('startChat happy path — optimistic state + chatStarting cleared in finally', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const result = await actions.startChat('  hello world  ');
      // Returned id is the optimistic '' (chat.start has not arrived yet).
      expect(result).toBe('');
      // chatStarting cleared by finally block.
      expect(state.chatStarting).toBe(false);
      // chatSession populated optimistically.
      expect(state.chatSession).not.toBeNull();
      expect(state.chatSession?.chat_session_id).toBe('');
      expect(state.chatSession?.streaming).toBe(true);
      expect(state.chatSession?.status).toBe('streaming');
      expect(state.chatSession?.messages).toHaveLength(1);
      expect(state.chatSession?.messages[0]?.role).toBe('user');
      // Trim must have removed surrounding whitespace.
      expect(state.chatSession?.messages[0]?.text).toBe('hello world');
      expect(state.chatSession?.messages[0]?.completed).toBe(true);
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
      expect(state.chatSession).toBeNull();
      expect(state.chatStarting).toBe(false);
      expect(postChatStartMock).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('startChat error path (first turn) rolls back chatSession to null + pushes error', async () => {
    postChatStartMock.mockRejectedValueOnce(new Error('network down'));
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const result = await actions.startChat('hello');
      expect(result).toBeNull();
      // First-turn rollback: chatSession back to null.
      expect(state.chatSession).toBeNull();
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
  it('chat.start adopts the optimistic chat_session_id', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('hi');
      expect(state.chatSession?.chat_session_id).toBe('');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'abc-123',
        prompt: 'hi',
      });
      expect(state.chatSession?.chat_session_id).toBe('abc-123');
      dispose();
    });
  });

  it('chat.message_delta accumulates text across multiple deltas', async () => {
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
      const msgs = state.chatSession?.messages ?? [];
      const last = msgs[msgs.length - 1];
      expect(last?.role).toBe('assistant');
      expect(last?.text).toBe('Hi there, friend!');
      expect(last?.completed).toBe(false);
      // User message is still there as the first entry.
      expect(msgs[0]?.role).toBe('user');
      expect(msgs).toHaveLength(2);
      dispose();
    });
  });

  it('chat.tool_call appends tool name to last assistant message tools_called[]', async () => {
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
      const msgs = state.chatSession?.messages ?? [];
      const last = msgs[msgs.length - 1];
      expect(last?.tools_called).toEqual(['read_file', 'grep']);
      dispose();
    });
  });

  it('chat.message_end seals last assistant message (completed=true) but does NOT clear streaming', async () => {
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
      const msgs = state.chatSession?.messages ?? [];
      const last = msgs[msgs.length - 1];
      expect(last?.completed).toBe(true);
      // Streaming flag is owned by chat.complete — message_end alone leaves it on.
      expect(state.chatSession?.streaming).toBe(true);
      dispose();
    });
  });

  it('chat.token_usage attaches the 6-field usage payload to the last assistant message', async () => {
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
      const msgs = state.chatSession?.messages ?? [];
      const last = msgs[msgs.length - 1];
      expect(last?.usage).toEqual({
        input: 123,
        output: 456,
        cacheRead: 12,
        cacheWrite: 7,
        provider: 'anthropic',
        model: 'claude-opus-4-7',
      });
      dispose();
    });
  });

  it('chat.error attaches error to last assistant message + flips status to error + pushError', async () => {
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
      const msgs = state.chatSession?.messages ?? [];
      const last = msgs[msgs.length - 1];
      expect(last?.error).toEqual({ code: 'CHAT_SESSION_ERROR', message: 'pi blew up' });
      expect(state.chatSession?.status).toBe('error');
      // pushError fired for global visibility.
      expect(state.errors.length).toBeGreaterThan(errorsBefore);
      expect(state.errors[state.errors.length - 1]?.message).toContain('chat error');
      expect(state.errors[state.errors.length - 1]?.message).toContain('CHAT_SESSION_ERROR');
      dispose();
    });
  });

  it('chat.complete clears streaming + sets status to done (no prior error)', async () => {
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
      expect(state.chatSession?.streaming).toBe(false);
      expect(state.chatSession?.status).toBe('done');
      dispose();
    });
  });

  it('chat.complete preserves status=error when chat.error fired first in the same turn', async () => {
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
      expect(state.chatSession?.streaming).toBe(false);
      // status preserved as 'error', NOT overwritten to 'done'.
      expect(state.chatSession?.status).toBe('error');
      dispose();
    });
  });

  it('stale chat_session_id event is silently dropped (no state mutation)', async () => {
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
      const beforeMessages = state.chatSession?.messages ?? [];
      // Stale delta from a different (or stale-tab) session.
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'wrong-id',
        text: 'should be dropped',
      });
      const afterMessages = state.chatSession?.messages ?? [];
      // Strict equality on length + content (no synthesis happened).
      expect(afterMessages).toHaveLength(beforeMessages.length);
      // The user message text is the only entry; no assistant synthesis from the stale delta.
      expect(afterMessages.every((m) => !m.text.includes('should be dropped'))).toBe(true);
      dispose();
    });
  });
});

describe('clearChat action', () => {
  it('clearChat wipes chatSession back to null', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('something');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-H',
        prompt: 'something',
      });
      expect(state.chatSession).not.toBeNull();
      actions.clearChat();
      expect(state.chatSession).toBeNull();
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
      // Messages array grew by 1 (one new user message).
      const userMsgs = state.chatSession?.messages.filter((m) => m.role === 'user') ?? [];
      expect(userMsgs).toHaveLength(2);
      expect(userMsgs[1]?.text).toBe('turn 2');
      // streaming + status flipped back to in-progress.
      expect(state.chatSession?.streaming).toBe(true);
      expect(state.chatSession?.status).toBe('streaming');
      dispose();
    });
  });
});

describe('applyEvent routing precedence', () => {
  it('chat.* events do not trigger init./cook./oauth. side effects', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      // No chatSession set — chat.start should be silently dropped (no session).
      // None of the other state slots should mutate either.
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'orphan',
        prompt: 'no session',
      });
      // Sanity: chatSession remains null, none of the other slots changed.
      expect(state.chatSession).toBeNull();
      expect(state.initSession).toBeNull();
      expect(state.vibeSession).toBeNull();
      expect(state.oauthFlow).toBeNull();
      expect(state.activeAgents.size).toBe(0);
      expect(state.activeSessionId).toBeNull();
      dispose();
    });
  });
});
