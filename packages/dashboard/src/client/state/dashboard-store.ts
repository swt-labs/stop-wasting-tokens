import type { Snapshot, SnapshotEvent } from '@swt-labs/dashboard-core';
import { createStore } from 'solid-js/store';

import {
  fetchArtifactRendered,
  fetchSnapshot,
  postCommand,
  postInit,
  postUatCheckpoint,
  type CommandResponse,
  type InitBody,
  type RenderedArtifact,
  type UatCheckpointBody,
} from '../services/api.js';
import { openSseConnection, type SseConnection } from '../services/sse.js';

export type ConnectionState = 'connecting' | 'connected' | 'error';

export interface DashboardErrorEntry {
  id: string;
  message: string;
  ts: string;
}

export interface LogLine {
  id: string;
  ts: string;
  channel: 'stdout' | 'stderr';
  line: string;
}

export interface UatModalState {
  phase: string;
  scenario: string;
  plan?: string;
}

export interface DashboardState {
  connection: ConnectionState;
  reconnectAttempt: number;
  snapshot: Snapshot | null;
  selectedArtifact: { phase: string; name: string } | null;
  artifactCache: Map<string, RenderedArtifact>;
  artifactLoading: boolean;
  artifactError: string | null;
  recentLogLines: LogLine[];
  uatModal: UatModalState | null;
  uatSubmitting: boolean;
  initSubmitting: boolean;
  commandSubmitting: boolean;
  errors: DashboardErrorEntry[];
}

export interface DashboardActions {
  bootstrap: () => Promise<void>;
  applyEvent: (evt: SnapshotEvent) => void;
  selectArtifact: (phase: string, name: string) => Promise<void>;
  openUatModal: (modal: UatModalState) => void;
  closeUatModal: () => void;
  submitUatCheckpoint: (result: 'pass' | 'fail', note?: string) => Promise<void>;
  initProject: (body: InitBody) => Promise<void>;
  runCommand: (input: string) => Promise<CommandResponse | null>;
  pushError: (message: string) => void;
  shutdown: () => void;
}

const ARTIFACT_CACHE_LIMIT = 32;
const RECENT_EVENTS_LIMIT = 100;
const RECENT_LOG_LIMIT = 200;

function cacheKey(phase: string, name: string): string {
  return `${phase}/${name}`;
}

export function createDashboardStore(): [DashboardState, DashboardActions] {
  const [state, setState] = createStore<DashboardState>({
    connection: 'connecting',
    reconnectAttempt: 0,
    snapshot: null,
    selectedArtifact: null,
    artifactCache: new Map<string, RenderedArtifact>(),
    artifactLoading: false,
    artifactError: null,
    recentLogLines: [],
    uatModal: null,
    uatSubmitting: false,
    initSubmitting: false,
    commandSubmitting: false,
    errors: [],
  });

  let sse: SseConnection | null = null;
  let logSeq = 0;

  const pushError = (message: string): void => {
    setState('errors', (prev) => {
      const entry: DashboardErrorEntry = {
        id: `err-${Date.now()}-${prev.length}`,
        message,
        ts: new Date().toISOString(),
      };
      const next = [...prev, entry];
      return next.slice(-10);
    });
  };

  const pushRecentEvent = (event: SnapshotEvent): void => {
    setState('snapshot', (prev) => {
      if (!prev) return prev;
      const next = [...prev.recent_events, event];
      return {
        ...prev,
        recent_events: next.slice(-RECENT_EVENTS_LIMIT),
      };
    });
  };

  const applyEvent = (evt: SnapshotEvent): void => {
    if (evt.type === 'snapshot.replace') {
      setState('snapshot', evt.snapshot);
      return;
    }
    if (evt.type === 'state.changed') {
      const partial = evt.snapshot;
      if (partial && Object.keys(partial).length > 0) {
        setState('snapshot', (prev) => {
          if (!prev) return prev;
          return { ...prev, ...partial };
        });
      }
      return;
    }
    if (evt.type === 'agent.spawn' || evt.type === 'agent.complete') {
      pushRecentEvent(evt);
      return;
    }
    if (evt.type === 'log.append') {
      logSeq += 1;
      const line: LogLine = {
        id: `log-${logSeq}`,
        ts: evt.ts,
        channel: evt.channel,
        line: evt.line,
      };
      setState('recentLogLines', (prev) => {
        const next = [...prev, line];
        return next.slice(-RECENT_LOG_LIMIT);
      });
      return;
    }
    if (evt.type === 'error') {
      pushError(`${evt.code}: ${evt.message}`);
      return;
    }
  };

  const bootstrap = async (): Promise<void> => {
    setState('connection', 'connecting');
    try {
      const snap = await fetchSnapshot();
      setState('snapshot', snap);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`initial snapshot fetch failed: ${message}`);
      setState('connection', 'error');
      return;
    }

    sse = openSseConnection(
      '/api/events',
      {
        onOpen: () => {
          setState('connection', 'connected');
          setState('reconnectAttempt', 0);
        },
        onError: () => {
          setState('connection', 'error');
        },
        onEvent: applyEvent,
      },
      {
        onReconnectAttempt: (attempt) => setState('reconnectAttempt', attempt),
        onReconnected: async () => {
          // Re-fetch snapshot to recover from any state drift during disconnect.
          try {
            const snap = await fetchSnapshot();
            setState('snapshot', snap);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            pushError(`snapshot re-fetch after reconnect failed: ${message}`);
          }
        },
      },
    );
  };

  const selectArtifact = async (phase: string, name: string): Promise<void> => {
    setState({ selectedArtifact: { phase, name }, artifactError: null });
    const key = cacheKey(phase, name);
    if (state.artifactCache.has(key)) {
      setState('artifactLoading', false);
      return;
    }
    setState('artifactLoading', true);
    try {
      const art = await fetchArtifactRendered(phase, name);
      setState('artifactCache', (prev) => {
        const next = new Map(prev);
        if (next.size >= ARTIFACT_CACHE_LIMIT) {
          const oldest = next.keys().next().value;
          if (oldest) next.delete(oldest);
        }
        next.set(key, art);
        return next;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState('artifactError', message);
      pushError(`artifact fetch failed: ${message}`);
    } finally {
      setState('artifactLoading', false);
    }
  };

  const openUatModal = (modal: UatModalState): void => {
    setState('uatModal', modal);
  };

  const closeUatModal = (): void => {
    setState('uatModal', null);
  };

  const submitUatCheckpoint = async (result: 'pass' | 'fail', note?: string): Promise<void> => {
    const modal = state.uatModal;
    if (!modal) return;
    setState('uatSubmitting', true);
    try {
      const body: UatCheckpointBody = {
        scenario: modal.scenario,
        result,
        ...(note !== undefined ? { note } : {}),
      };
      await postUatCheckpoint(modal.phase, body);
      closeUatModal();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`UAT checkpoint submit failed: ${message}`);
    } finally {
      setState('uatSubmitting', false);
    }
  };

  const appendLogLine = (line: string, channel: 'stdout' | 'stderr' = 'stdout'): void => {
    logSeq += 1;
    const entry: LogLine = {
      id: `log-init-${logSeq}`,
      ts: new Date().toISOString(),
      channel,
      line,
    };
    setState('recentLogLines', (prev) => {
      const next = [...prev, entry];
      return next.slice(-RECENT_LOG_LIMIT);
    });
  };

  const initProject = async (body: InitBody): Promise<void> => {
    setState('initSubmitting', true);
    // Capture the current snapshot so we can roll back if init fails.
    const previousSnapshot = state.snapshot;
    // Optimistically flip is_initialized: true so App.tsx unmounts InitScreen
    // and mounts the 4-panel grid immediately — no waiting on POST + GET
    // round-trips. Project/milestone stay null; TopBar's <Show> fallback
    // already handles that case ("…" placeholder). The real values arrive
    // when fetchSnapshot resolves below.
    const optimisticSnap: Snapshot = previousSnapshot
      ? { ...previousSnapshot, is_initialized: true, generated_at: new Date().toISOString() }
      : {
          schema_version: '1',
          generated_at: new Date().toISOString(),
          project: null,
          milestone: null,
          phases: [],
          active_agent: null,
          recent_events: [],
          cost_summary: null,
          is_initialized: true,
        };
    setState('snapshot', optimisticSnap);
    appendLogLine(`[ok] Initialized .swt-planning/ — type 'help' for available subcommands.`);
    try {
      const response = await postInit(body);
      appendLogLine(`[ok] Project ${body.name} ready at ${response.root}`);
      // Replace the optimistic snapshot with the server's real one. After
      // /api/init, the daemon's snapshotter is live and /api/snapshot returns
      // populated project/milestone/phases.
      const snap = await fetchSnapshot();
      setState('snapshot', snap);
    } catch (err: unknown) {
      // Roll back the optimistic flip — InitScreen reappears so the user can
      // see the error and retry.
      setState('snapshot', previousSnapshot);
      const message = err instanceof Error ? err.message : String(err);
      pushError(`init failed: ${message}`);
      throw err;
    } finally {
      setState('initSubmitting', false);
    }
  };

  const appendCommandLines = (response: CommandResponse, input: string): void => {
    const ts = new Date().toISOString();
    const inputLine: LogLine = {
      id: `log-cmd-${++logSeq}`,
      ts,
      channel: 'stdout',
      line: `$ swt ${input}`,
    };
    const lines: LogLine[] = [inputLine];
    for (const raw of response.stdout.split('\n')) {
      if (raw.length === 0) continue;
      lines.push({ id: `log-cmd-${++logSeq}`, ts, channel: 'stdout', line: raw });
    }
    for (const raw of response.stderr.split('\n')) {
      if (raw.length === 0) continue;
      lines.push({ id: `log-cmd-${++logSeq}`, ts, channel: 'stderr', line: raw });
    }
    if (response.exit_code !== 0) {
      lines.push({
        id: `log-cmd-${++logSeq}`,
        ts,
        channel: 'stderr',
        line: `[exit ${response.exit_code} · ${response.duration_ms}ms]`,
      });
    }
    setState('recentLogLines', (prev) => {
      const next = [...prev, ...lines];
      return next.slice(-RECENT_LOG_LIMIT);
    });
  };

  const runCommand = async (input: string): Promise<CommandResponse | null> => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    setState('commandSubmitting', true);
    try {
      const result = await postCommand({ input: trimmed });
      appendCommandLines(result, trimmed);
      // Some commands (e.g. `init`, `vibe`, `archive`) mutate `.swt-planning/`,
      // so re-fetch snapshot opportunistically. SSE state.changed events also
      // catch this, but a deterministic re-fetch after a user-triggered
      // command is the simplest contract.
      try {
        const snap = await fetchSnapshot();
        setState('snapshot', snap);
      } catch {
        /* ignore — log lines already captured */
      }
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`command failed: ${message}`);
      return null;
    } finally {
      setState('commandSubmitting', false);
    }
  };

  const shutdown = (): void => {
    sse?.close();
    sse = null;
  };

  return [
    state,
    {
      bootstrap,
      applyEvent,
      selectArtifact,
      openUatModal,
      closeUatModal,
      submitUatCheckpoint,
      initProject,
      runCommand,
      pushError,
      shutdown,
    },
  ];
}
