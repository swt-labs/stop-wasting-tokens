import type { CommandResponse, InitResponse, Snapshot } from '@swt-labs/dashboard-core';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchSnapshotMock = vi.fn();
const postInitMock = vi.fn();
const postCommandMock = vi.fn();
const postUatCheckpointMock = vi.fn();
const fetchArtifactRenderedMock = vi.fn();
const openSseConnectionMock = vi.fn();

vi.mock('../src/client/services/api.js', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  postInit: (...args: unknown[]) => postInitMock(...args),
  postCommand: (...args: unknown[]) => postCommandMock(...args),
  postUatCheckpoint: (...args: unknown[]) => postUatCheckpointMock(...args),
  fetchArtifactRendered: (...args: unknown[]) => fetchArtifactRenderedMock(...args),
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
