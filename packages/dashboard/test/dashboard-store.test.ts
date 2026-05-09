import type { CommandResponse, InitResponse, Snapshot } from '@swt-labs/dashboard-core';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchSnapshotMock = vi.fn();
const postInitMock = vi.fn();
const postCommandMock = vi.fn();
const postUatCheckpointMock = vi.fn();
const fetchArtifactRenderedMock = vi.fn();
const postVibeStartMock = vi.fn();
const postVibeReplyMock = vi.fn();
const openSseConnectionMock = vi.fn();

vi.mock('../src/client/services/api.js', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  postInit: (...args: unknown[]) => postInitMock(...args),
  postCommand: (...args: unknown[]) => postCommandMock(...args),
  postUatCheckpoint: (...args: unknown[]) => postUatCheckpointMock(...args),
  fetchArtifactRendered: (...args: unknown[]) => fetchArtifactRenderedMock(...args),
  postVibeStart: (...args: unknown[]) => postVibeStartMock(...args),
  postVibeReply: (...args: unknown[]) => postVibeReplyMock(...args),
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

import { createDashboardStore } from '../src/client/state/dashboard-store.js';

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schema_version: '1',
    generated_at: '2026-05-09T00:00:00Z',
    project: null,
    milestone: null,
    phases: [],
    active_agent: null,
    recent_events: [],
    cost_summary: null,
    is_initialized: true,
    ...overrides,
  };
}

beforeEach(() => {
  fetchSnapshotMock.mockReset();
  postInitMock.mockReset();
  postCommandMock.mockReset();
  postUatCheckpointMock.mockReset();
  fetchArtifactRenderedMock.mockReset();
  postVibeStartMock.mockReset();
  postVibeReplyMock.mockReset();
  openSseConnectionMock.mockReset();
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initProject', () => {
  it('optimistically flips is_initialized:true before the POST resolves', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const initResponse: InitResponse = {
        initialized: true,
        root: '/tmp/proj',
        files: ['.swt-planning/PROJECT.md'],
      };
      // Resolve postInit only after we observe the optimistic flip.
      let resolveInit: (v: InitResponse) => void = () => {};
      postInitMock.mockReturnValue(
        new Promise<InitResponse>((resolve) => {
          resolveInit = resolve;
        }),
      );
      fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));

      const initPromise = actions.initProject({ name: 'proj' });
      // After awaiting a microtask, the optimistic flip should be visible.
      await Promise.resolve();
      expect(state.snapshot?.is_initialized).toBe(true);
      expect(state.initSubmitting).toBe(true);

      resolveInit(initResponse);
      await initPromise;
      expect(state.initSubmitting).toBe(false);
      expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('rolls back the optimistic flip when postInit rejects', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const previous = makeSnapshot({ is_initialized: false });
      // Seed the previous snapshot via applyEvent (snapshot.replace).
      actions.applyEvent({ type: 'snapshot.replace', snapshot: previous });
      expect(state.snapshot?.is_initialized).toBe(false);

      postInitMock.mockRejectedValue(new Error('init_failed: EACCES'));

      await expect(actions.initProject({ name: 'proj' })).rejects.toThrow('init_failed');

      expect(state.snapshot?.is_initialized).toBe(false);
      expect(state.errors.at(-1)?.message).toContain('init_failed');
      dispose();
    });
  });
});

describe('runCommand verb-aware refresh', () => {
  function makeCommandResponse(): CommandResponse {
    return {
      ok: true,
      command_id: 'cmd-1',
      stdout: 'ok\n',
      stderr: '',
      exit_code: 0,
      duration_ms: 12,
    };
  }

  it('re-fetches snapshot for mutating verbs (init, vibe, archive, fix)', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postCommandMock.mockResolvedValue(makeCommandResponse());
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      for (const verb of ['init my-proj', 'vibe', 'archive', 'fix something']) {
        fetchSnapshotMock.mockClear();
        await actions.runCommand(verb);
        expect(fetchSnapshotMock, `verb=${verb}`).toHaveBeenCalledTimes(1);
      }
      dispose();
    });
  });

  it('does NOT re-fetch snapshot for read verbs (status, help, doctor, version, update, detect-phase)', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postCommandMock.mockResolvedValue(makeCommandResponse());
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      for (const verb of ['status', 'help', 'doctor', 'version', 'update', 'detect-phase']) {
        fetchSnapshotMock.mockClear();
        await actions.runCommand(verb);
        expect(fetchSnapshotMock, `verb=${verb}`).not.toHaveBeenCalled();
      }
      dispose();
    });
  });

  it('treats verb matching as case-insensitive on the first token', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postCommandMock.mockResolvedValue(makeCommandResponse());
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      await actions.runCommand('INIT myproj --description hi');
      expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
      dispose();
    });
  });
});

describe('vibe session lifecycle', () => {
  it('startVibeSession sets the active session and clears stale state', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({ session_id: 'sess-123', state: 'idle', agent_backend: 'codex' });

      const id = await actions.startVibeSession('build me a snake game');
      expect(id).toBe('sess-123');
      expect(state.vibeSession?.session_id).toBe('sess-123');
      expect(state.vibeSession?.initial_prompt).toBe('build me a snake game');
      expect(state.vibeSession?.conversation).toEqual([]);
      expect(state.vibeStarting).toBe(false);
      dispose();
    });
  });

  it('startVibeSession captures agent_backend=none and emits a setup-hint log line', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({
        session_id: 'sess-no-agent',
        state: 'idle',
        agent_backend: 'none',
      });
      await actions.startVibeSession('test prompt');
      expect(state.vibeSession?.agent_backend).toBe('none');
      // The hint log line should appear on stderr channel.
      const stderrLines = state.recentLogLines.filter((l) => l.channel === 'stderr');
      expect(stderrLines.some((l) => l.line.includes('SWT_VIBE_AGENT=codex'))).toBe(true);
      dispose();
    });
  });

  it('startVibeSession returns null on rejection and pushes an error', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockRejectedValue(new Error('vibe_start_failed'));
      const id = await actions.startVibeSession('test');
      expect(id).toBeNull();
      expect(state.vibeSession).toBeNull();
      expect(state.errors.at(-1)?.message).toContain('vibe_start_failed');
      dispose();
    });
  });

  it('agent.prompt event appends to conversation as pending when session_id matches', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({ session_id: 'sess-A', state: 'idle', agent_backend: 'codex' });
      await actions.startVibeSession('test');

      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'What goal?',
      });
      expect(state.vibeSession?.conversation).toHaveLength(1);
      expect(state.vibeSession?.conversation[0]).toMatchObject({
        prompt_id: 'p-1',
        question: 'What goal?',
        status: 'pending',
      });
      dispose();
    });
  });

  it('agent.prompt for a different session_id is ignored', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({ session_id: 'sess-A', state: 'idle', agent_backend: 'codex' });
      await actions.startVibeSession('test');

      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-B',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'cross-session',
      });
      expect(state.vibeSession?.conversation).toHaveLength(0);
      dispose();
    });
  });

  it('replyToActivePrompt POSTs reply, updates conversation entry to answered', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({ session_id: 'sess-A', state: 'idle', agent_backend: 'codex' });
      postVibeReplyMock.mockResolvedValue({ ok: true, accepted: true });
      await actions.startVibeSession('test');
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'q?',
      });

      const ok = await actions.replyToActivePrompt({ kind: 'free_form', text: 'a snake game' });
      expect(ok).toBe(true);
      expect(postVibeReplyMock).toHaveBeenCalledWith('sess-A', {
        prompt_id: 'p-1',
        answer: { kind: 'free_form', text: 'a snake game' },
      });
      const entry = state.vibeSession?.conversation[0];
      expect(entry?.status).toBe('answered');
      expect(entry?.reply).toEqual({ kind: 'free_form', text: 'a snake game' });
      dispose();
    });
  });

  it('replyToActivePrompt returns false when no pending prompt exists', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({ session_id: 'sess-A', state: 'idle', agent_backend: 'codex' });
      await actions.startVibeSession('test');
      const ok = await actions.replyToActivePrompt({ kind: 'free_form', text: 'a' });
      expect(ok).toBe(false);
      expect(postVibeReplyMock).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('agent.prompt.timeout flips matching pending entry to expired', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({ session_id: 'sess-A', state: 'idle', agent_backend: 'codex' });
      await actions.startVibeSession('test');
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'q?',
      });
      actions.applyEvent({
        type: 'agent.prompt.timeout',
        ts: '2026-05-09T10:05:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        expired_at: '2026-05-09T10:05:00Z',
      });
      const entry = state.vibeSession?.conversation[0];
      expect(entry?.status).toBe('expired');
      expect(entry?.resolved_at).toBe('2026-05-09T10:05:00Z');
      dispose();
    });
  });

  it('multiple sequential prompts stack as a conversation thread', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({ session_id: 'sess-A', state: 'idle', agent_backend: 'codex' });
      postVibeReplyMock.mockResolvedValue({ ok: true, accepted: true });
      await actions.startVibeSession('test');

      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'goal?',
      });
      await actions.replyToActivePrompt({ kind: 'free_form', text: 'snake' });
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:01:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-2',
        subtype: 'clarification',
        question: 'color?',
      });

      const conv = state.vibeSession!.conversation;
      expect(conv).toHaveLength(2);
      expect(conv[0]?.status).toBe('answered');
      expect(conv[1]?.status).toBe('pending');
      dispose();
    });
  });
});

describe('connection state transitions', () => {
  it('transitions connecting -> syncing -> connected on the happy path', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      expect(state.connection).toBe('connecting');

      let onOpen: (() => void) | undefined;
      openSseConnectionMock.mockImplementation((_url: unknown, handlers: { onOpen?: () => void }) => {
        onOpen = handlers.onOpen;
        return { close: () => {} };
      });
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      await actions.bootstrap();
      // After fetchSnapshot resolves and SSE opens (handlers wired but onOpen
      // not yet fired), connection is 'syncing'.
      expect(state.connection).toBe('syncing');

      onOpen?.();
      expect(state.connection).toBe('connected');
      dispose();
    });
  });

  it('stays in syncing on a transient SSE error before the first onOpen', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      let onError: ((err: unknown) => void) | undefined;
      openSseConnectionMock.mockImplementation(
        (_url: unknown, handlers: { onError?: (err: unknown) => void }) => {
          onError = handlers.onError;
          return { close: () => {} };
        },
      );
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      await actions.bootstrap();
      expect(state.connection).toBe('syncing');

      onError?.(new Error('boom'));
      expect(state.connection).toBe('syncing');
      dispose();
    });
  });

  it('flips to error after a successful open then a drop', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      let onOpen: (() => void) | undefined;
      let onError: ((err: unknown) => void) | undefined;
      openSseConnectionMock.mockImplementation(
        (
          _url: unknown,
          handlers: { onOpen?: () => void; onError?: (err: unknown) => void },
        ) => {
          onOpen = handlers.onOpen;
          onError = handlers.onError;
          return { close: () => {} };
        },
      );
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      await actions.bootstrap();
      onOpen?.();
      expect(state.connection).toBe('connected');
      onError?.(new Error('drop'));
      expect(state.connection).toBe('error');
      dispose();
    });
  });
});
