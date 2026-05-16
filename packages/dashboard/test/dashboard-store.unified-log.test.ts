import type { LogEntry } from '@swt-labs/shared';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Milestone 13 / Phase 01 — dashboard-store unified-log reducer coverage.
 *
 * Pairs with `dashboard-store.chat.test.ts` (chat-reducer focused) +
 * `dashboard-store-cook-events.test.ts` (cook-reducer focused). This file
 * is the cross-cutting coverage: interleaved init/cook/chat events, the
 * previously-invisible budget surfacing (Scout Cross-Cutting Finding #1),
 * `clearChat` scope, `chat.message_delta` in-place update, the
 * UNIFIED_LOG_LIMIT cap, `appendLogLine` → system-internal entries,
 * `chat.error` → chat-error entry + chatStatus='error', and the
 * **continuous chat thread** test required by Lead must_have #13 (the
 * literal phrase "continuous chat thread" appears in the test name as a
 * grep target).
 */

const fetchSnapshotMock = vi.fn();
const postCookStartMock = vi.fn();
const postChatStartMock = vi.fn();
const openSseConnectionMock = vi.fn();

vi.mock('../src/client/services/api.js', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  postCookStart: (...args: unknown[]) => postCookStartMock(...args),
  postChatStart: (...args: unknown[]) => postChatStartMock(...args),
  // The store imports many api helpers; stub them all to noop so unrelated
  // code paths (toolsFetchers) don't blow up during construction.
  postInit: vi.fn(),
  postCommand: vi.fn(),
  postUatCheckpoint: vi.fn(),
  fetchArtifactRendered: vi.fn(),
  postPromptRespond: vi.fn(),
  fetchConfig: vi.fn(),
  fetchDoctor: vi.fn(),
  fetchDetectPhase: vi.fn(),
  fetchUpdate: vi.fn(),
  fetchCommands: vi.fn(),
  postConfig: vi.fn(),
  postUpdateApply: vi.fn(),
  fetchProviderAuth: vi.fn(),
  postProviderAuth: vi.fn(),
  fetchUserNotes: vi.fn(),
  postUserNotes: vi.fn(),
  postOAuthStart: vi.fn(),
  postOAuthCode: vi.fn(),
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

import { UNIFIED_LOG_LIMIT, createDashboardStore } from '../src/client/state/dashboard-store.js';

beforeEach(() => {
  postCookStartMock.mockReset();
  postChatStartMock.mockReset();
  openSseConnectionMock.mockReset();
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('unifiedLog — interleaved event ordering', () => {
  it('init.start → cook.priority_decision → cook.agent_spawn → log.append → chat events produce a chronologically ordered log', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      // 1. Init
      actions.applyEvent({
        type: 'init.start',
        ts: '2026-05-16T10:00:00Z',
        session_id: 'init-1',
      });
      // 2. Cook starts
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: '2026-05-16T10:01:00Z',
        session_id: 'cook-12345678',
        priority: 8,
        mode: 'autonomous',
      });
      // 3. Cook spawns an agent
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-16T10:01:01Z',
        session_id: 'cook-12345678',
        role: 'dev',
        sub_session_id: 'sub-abcd1234',
      });
      // 4. SSE log line lands
      actions.applyEvent({
        type: 'log.append',
        ts: '2026-05-16T10:01:02Z',
        channel: 'stdout',
        line: 'building…',
      });
      // 5. Chat starts (a chat-user entry pushes via startChat)
      await actions.startChat('how is the build going?');
      // 6. Cook tool call mid-chat
      actions.applyEvent({
        type: 'cook.tool_call',
        ts: '2026-05-16T10:01:04Z',
        session_id: 'cook-12345678',
        sub_session_id: 'sub-abcd1234',
        tool: 'Read',
        input_excerpt: 'packages/...',
      });

      const kinds = state.unifiedLog.map((e) => e.kind);
      // Strict ordering — chronological by event arrival.
      expect(kinds).toEqual([
        'init',
        'cook-status', // cook.priority_decision
        'cook-agent', // cook.agent_spawn
        'system', // log.append
        'chat-user', // startChat optimistic push
        'cook-tool', // cook.tool_call
      ]);
      expect(state.unifiedLog).toHaveLength(6);
      dispose();
    });
  });
});

describe('unifiedLog — budget event surfacing (Scout Cross-Cutting Finding #1)', () => {
  it('cook.budget_exceeded produces a cook-status entry with subtype=budget_exceeded', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.budget_exceeded',
        ts: '2026-05-16T10:30:00Z',
        session_id: 'cook-12345678',
        reason: 'paused_on_entry',
        spent_usd: 1.5,
        ceiling_usd: 1.0,
        threshold: 1.0,
      });
      const budget = state.unifiedLog.filter(
        (e) => e.kind === 'cook-status' && e.subtype === 'budget_exceeded',
      );
      expect(budget).toHaveLength(1);
      dispose();
    });
  });

  it('cook.budget_resume produces a cook-status entry with subtype=budget_resume', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.budget_resume',
        ts: '2026-05-16T10:35:00Z',
        session_id: 'cook-12345678',
        spent_usd: 1.5,
        ceiling_usd: 5.0,
      });
      const resume = state.unifiedLog.filter(
        (e) => e.kind === 'cook-status' && e.subtype === 'budget_resume',
      );
      expect(resume).toHaveLength(1);
      dispose();
    });
  });
});

describe('clearChat scope', () => {
  it('clearChat preserves cook/init/system entries (removes only chat-* entries)', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      // Seed a mixed log.
      actions.applyEvent({
        type: 'init.start',
        ts: '2026-05-16T10:00:00Z',
        session_id: 'init-1',
      });
      actions.applyEvent({
        type: 'log.append',
        ts: '2026-05-16T10:00:01Z',
        channel: 'stdout',
        line: 'hello',
      });
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: '2026-05-16T10:01:00Z',
        session_id: 'cook-1',
        priority: 8,
        mode: 'autonomous',
      });
      await actions.startChat('chat me');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:01:10Z',
        chat_session_id: 'sess-clear',
        prompt: 'chat me',
      });
      const nonChatBefore = state.unifiedLog.filter(
        (e) => e.kind !== 'chat-user' && e.kind !== 'chat-assistant' && e.kind !== 'chat-error',
      ).length;
      expect(nonChatBefore).toBeGreaterThanOrEqual(3);

      actions.clearChat();
      // No chat entries remain.
      expect(
        state.unifiedLog.filter(
          (e) => e.kind === 'chat-user' || e.kind === 'chat-assistant' || e.kind === 'chat-error',
        ),
      ).toHaveLength(0);
      // Non-chat entries preserved (+1 for the system-internal breadcrumb
      // that clearChat appends).
      const nonChatAfter = state.unifiedLog.filter(
        (e) => e.kind !== 'chat-user' && e.kind !== 'chat-assistant' && e.kind !== 'chat-error',
      ).length;
      expect(nonChatAfter).toBe(nonChatBefore + 1);
      // Chat thread state reset.
      expect(state.chat_session_id).toBeNull();
      expect(state.chatStreaming).toBe(false);
      expect(state.chatStatus).toBe('idle');
      dispose();
    });
  });
});

describe('continuous chat thread across verb-chip mode switch', () => {
  it('chat_session_id persists across cook session (continuous chat thread)', async () => {
    postChatStartMock.mockResolvedValue(undefined);
    postCookStartMock.mockResolvedValueOnce({
      session_id: 'cook-mid-thread',
      started_at: '2026-05-16T10:05:00Z',
    });
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();

      // Turn 1: open the chat thread.
      await actions.startChat('hi');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'thread-AAA',
        prompt: 'hi',
      });
      expect(state.chat_session_id).toBe('thread-AAA');
      actions.applyEvent({
        type: 'chat.complete',
        ts: '2026-05-16T10:00:05Z',
        chat_session_id: 'thread-AAA',
      });

      // Verb-chip switch to cook: startVibeSession must NOT touch the chat thread.
      await actions.startVibeSession('build a thing');
      // Chat thread id survives the cook session.
      expect(state.chat_session_id).toBe('thread-AAA');

      // Turn 2: another chat call REUSES the existing id.
      await actions.startChat('back to chat');
      expect(state.chat_session_id).toBe('thread-AAA');
      // postChatStart's second call passed the existing id back to the server.
      expect(postChatStartMock).toHaveBeenLastCalledWith('back to chat', 'thread-AAA');

      // Both chat-user entries share the same chat_session_id.
      const users = state.unifiedLog.filter(
        (e): e is Extract<LogEntry, { kind: 'chat-user' }> => e.kind === 'chat-user',
      );
      expect(users).toHaveLength(2);
      expect(users[0]?.chat_session_id).toBe('thread-AAA');
      expect(users[1]?.chat_session_id).toBe('thread-AAA');
      dispose();
    });
  });
});

describe('chat.message_delta streaming optimization', () => {
  it('chat.message_delta updates the last chat-assistant entry text IN PLACE (length unchanged after multiple deltas)', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('hi');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-delta',
        prompt: 'hi',
      });
      // First delta synthesizes a chat-assistant entry.
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'sess-delta',
        text: 'A',
      });
      const lengthAfterFirst = state.unifiedLog.length;
      // Second + third deltas update IN PLACE.
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:02Z',
        chat_session_id: 'sess-delta',
        text: 'B',
      });
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: '2026-05-16T10:00:03Z',
        chat_session_id: 'sess-delta',
        text: 'C',
      });
      // Length did NOT grow after the in-place updates.
      expect(state.unifiedLog).toHaveLength(lengthAfterFirst);
      const last = state.unifiedLog[state.unifiedLog.length - 1];
      if (last?.kind === 'chat-assistant') {
        expect(last.text).toBe('ABC');
      }
      dispose();
    });
  });
});

describe('UNIFIED_LOG_LIMIT cap', () => {
  it('synthesizing more than UNIFIED_LOG_LIMIT entries caps the array at the limit', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      const overflow = UNIFIED_LOG_LIMIT + 25;
      for (let i = 0; i < overflow; i++) {
        actions.applyEvent({
          type: 'log.append',
          ts: '2026-05-16T10:00:00Z',
          channel: 'stdout',
          line: `synthetic line ${i}`,
        });
      }
      expect(state.unifiedLog).toHaveLength(UNIFIED_LOG_LIMIT);
      // The tail-keep behavior: the LAST overflow entry survived.
      const tail = state.unifiedLog[state.unifiedLog.length - 1];
      if (tail?.kind === 'system') {
        expect(tail.line).toBe(`synthetic line ${overflow - 1}`);
      }
      dispose();
    });
  });
});

describe('appendLogLine internal channel', () => {
  it('clearChat breadcrumb produces a system entry with channel=internal', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('seed');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-app',
        prompt: 'seed',
      });
      const before = state.unifiedLog.length;
      actions.clearChat();
      // The new entry produced by clearChat's appendLogLine has
      // channel='internal' (the new K-3 discriminator).
      const after = state.unifiedLog;
      const newest = after[after.length - 1];
      expect(newest?.kind).toBe('system');
      if (newest?.kind === 'system') {
        expect(newest.channel).toBe('internal');
        expect(newest.line).toContain('[chat] conversation cleared');
      }
      // length didn't shrink to zero — only chat-* entries were dropped.
      expect(after.length).toBeGreaterThan(0);
      void before;
      dispose();
    });
  });
});

describe('chat.error reducer', () => {
  it('chat.error pushes a chat-error LogEntry AND flips chatStatus to error', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('break');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'sess-err',
        prompt: 'break',
      });
      actions.applyEvent({
        type: 'chat.error',
        ts: '2026-05-16T10:00:01Z',
        chat_session_id: 'sess-err',
        code: 'CHAT_PROMPT_ERROR',
        message: 'oh no',
      });
      const errors = state.unifiedLog.filter((e) => e.kind === 'chat-error');
      expect(errors).toHaveLength(1);
      const err = errors[0];
      if (err?.kind === 'chat-error') {
        expect(err.code).toBe('CHAT_PROMPT_ERROR');
        expect(err.message).toBe('oh no');
      }
      expect(state.chatStatus).toBe('error');
      dispose();
    });
  });
});

describe('log.append channel preservation', () => {
  it('SSE log.append entries keep their native channel (stdout/stderr) — not collapsed to internal', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'log.append',
        ts: '2026-05-16T10:00:00Z',
        channel: 'stdout',
        line: 'stdout line',
      });
      actions.applyEvent({
        type: 'log.append',
        ts: '2026-05-16T10:00:01Z',
        channel: 'stderr',
        line: 'stderr line',
      });
      const entries = state.unifiedLog.filter(
        (e): e is Extract<LogEntry, { kind: 'system' }> => e.kind === 'system',
      );
      expect(entries).toHaveLength(2);
      expect(entries[0]?.channel).toBe('stdout');
      expect(entries[1]?.channel).toBe('stderr');
      dispose();
    });
  });
});

describe('chat.start backfill of optimistic chat_session_id', () => {
  it('chat.start adoption backfills the optimistic chat-user entry chat_session_id', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('first');
      // Optimistic — chat-user entry written with chat_session_id=''.
      const beforeChats = state.unifiedLog.filter(
        (e): e is Extract<LogEntry, { kind: 'chat-user' }> => e.kind === 'chat-user',
      );
      expect(beforeChats[0]?.chat_session_id).toBe('');
      // chat.start lands with the real id.
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-16T10:00:00Z',
        chat_session_id: 'real-id-XYZ',
        prompt: 'first',
      });
      // Now the optimistic entry's chat_session_id has been backfilled.
      const afterChats = state.unifiedLog.filter(
        (e): e is Extract<LogEntry, { kind: 'chat-user' }> => e.kind === 'chat-user',
      );
      expect(afterChats[0]?.chat_session_id).toBe('real-id-XYZ');
      expect(state.chat_session_id).toBe('real-id-XYZ');
      dispose();
    });
  });
});

describe('cook.agent_result enriches the cook-agent entry with cost + elapsed', () => {
  it('cook.agent_result pushes a cook-agent entry with result_status, cost_usd, elapsed_ms', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-16T10:00:00Z',
        session_id: 'cook-1',
        role: 'dev',
        sub_session_id: 'sub-1',
      });
      actions.applyEvent({
        type: 'cook.agent_result',
        ts: '2026-05-16T10:00:05Z',
        session_id: 'cook-1',
        sub_session_id: 'sub-1',
        status: 'completed',
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cost_usd: 0.0123,
        },
      });
      const agents = state.unifiedLog.filter(
        (e): e is Extract<LogEntry, { kind: 'cook-agent' }> => e.kind === 'cook-agent',
      );
      // Two entries: spawn + result.
      expect(agents).toHaveLength(2);
      const result = agents[1];
      if (result?.event === 'result') {
        expect(result.result_status).toBe('completed');
        expect(result.cost_usd).toBe(0.0123);
        expect(result.elapsed_ms).toBeGreaterThan(0);
      }
      dispose();
    });
  });
});
