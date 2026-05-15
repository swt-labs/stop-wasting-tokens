/**
 * Plan 03-01 T4 — Pattern B greenfield E2E smoke for the dashboard init
 * Lead lifecycle. Drives a real `createDashboardStore` through the seven
 * lifecycle cases the plan's `must_haves.truths` enumerate, covering the
 * regression for the removed optimistic `is_initialized` flip plus the
 * three SSE event handlers (`init.start` / `init.complete` / `init.error`).
 *
 * Pattern B (mocked api + sse + direct createDashboardStore) — no real
 * Hono daemon, no real subprocess, no filesystem I/O. SSE events are
 * pumped via `actions.applyEvent(...)` directly, which is the same
 * function the bootstrap wires as the `onEvent` callback. The mock list
 * mirrors `e2e-greenfield-smoke.test.ts` (the canonical Pattern B
 * template, including the `postOAuthStart` / `postOAuthCode` exports the
 * older `dashboard-store-cook-events.test.ts` template lacks).
 *
 * The seven cases mirror the plan's `must_haves.truths` enumeration:
 *
 *   1. Initial greenfield state.
 *   2. POST /api/init success → detecting (regression: is_initialized
 *      stays false — old code flipped it true here).
 *   3. init.start → defensive [init] log line; initSession still detecting.
 *   4. init.complete → is_initialized flips, initSession clears, log line.
 *   5. init.error → status=error + errorMessage set + state.errors
 *      non-empty + is_initialized still false.
 *   6. Error rollback re-submit → initSession resets to detecting with
 *      a fresh session_id; errorMessage cleared.
 *   7. Full happy-path transition chain greenfield → detecting →
 *      init.start → init.complete → ready dashboard.
 *
 * Each `it(...)` is self-contained (its own createRoot + bootstrap)
 * because cases 5 / 6 need fresh state and a shared describe-level fixture
 * would couple them in a way that obscures the regression intent.
 */

import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  fetchUserNotes: vi.fn(),
  postUserNotes: vi.fn(),
  postOAuthStart: vi.fn(),
  postOAuthCode: vi.fn(),
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

import { createDashboardStore } from '../src/client/state/dashboard-store.js';

beforeEach(() => {
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Mirror of the helper in `e2e-greenfield-smoke.test.ts` (NOT exported
 * there — inlined here per the plan T4 scaffold note). Builds the minimal
 * SnapshotSchema-shaped object the store's `state.changed` reducer
 * accepts; greenfield (`is_initialized: false`) is the default. The
 * reducer merges this into the existing snapshot via `{...prev, ...partial}`,
 * which requires the snapshot to be non-null — bootstrap()'s
 * fetchSnapshotMock satisfies that precondition before any state.changed
 * pumps below.
 */
function _buildSnapshotPartial(
  overrides: Partial<{
    is_initialized: boolean;
    phase_count: number;
    phases: ReadonlyArray<{ position: string; state: string }>;
  }> = {},
): Record<string, unknown> {
  const partial: Record<string, unknown> = {};
  if (overrides.is_initialized !== undefined) {
    partial.is_initialized = overrides.is_initialized;
  }
  if (overrides.phase_count !== undefined) {
    partial.milestone = {
      name: 'snake',
      phase_count: overrides.phase_count,
      phase_index: 1,
    };
  }
  if (overrides.phases !== undefined) {
    partial.phases = overrides.phases.map((p) => ({
      position: p.position,
      slug: `${p.position}-phase`,
      name: `Phase ${p.position}`,
      state: p.state,
      qa_status: 'none',
      artifacts: [],
    }));
  }
  return partial;
}

/** Greenfield snapshot shape used by the initial fetchSnapshotMock for
 *  every test in this file. The store's `state.changed` merge needs a
 *  base object; an empty SnapshotSchema-compatible payload suffices. */
function greenfieldSnapshot(): Record<string, unknown> {
  return {
    schema_version: '1',
    generated_at: '2026-05-15T10:00:00Z',
    project: null,
    milestone: null,
    phases: [],
    recent_events: [],
    active_agents: [],
    cost_summary: null,
    is_initialized: false,
  };
}

describe('e2e: dashboard init Lead lifecycle (Plan 03-01 T4)', () => {
  it('case 1: initial greenfield state — is_initialized false + initSession null', async () => {
    fetchSnapshotMock.mockResolvedValue(greenfieldSnapshot());

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.bootstrap();

      expect(state.snapshot?.is_initialized).toBe(false);
      expect(state.initSession).toBeNull();
      // InitScreen mount condition is `!isInitialized()` — true here.
      const isInitialized = state.snapshot?.is_initialized ?? false;
      expect(!isInitialized).toBe(true);

      dispose();
    });
  });

  it('case 2: POST /api/init success → detecting (REGRESSION: is_initialized stays false)', async () => {
    // Phase 02 mints session_id server-side; tests pass it through the
    // postInit mock so the store's `(response as { session_id?: string })`
    // soft-read captures it. Production Zod-strips, then the real id is
    // adopted from the init.start SSE event.
    fetchSnapshotMock.mockResolvedValue(greenfieldSnapshot());
    postInitMock.mockResolvedValue({
      initialized: true,
      root: '/tmp/proj',
      files: ['.swt-planning/PROJECT.md'],
      session_id: 'init-abc',
    });

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.bootstrap();

      await actions.initProject({ name: 'test', description: 'desc' });

      // The regression assertion: BEFORE plan 03-01 T2 this line would
      // have been `true` (the optimistic flip fired before postInit even
      // resolved). After T2 the SSE init.complete event is the only path
      // to a true here.
      expect(state.snapshot?.is_initialized).toBe(false);
      expect(state.initSession?.status).toBe('detecting');
      expect(state.initSession?.name).toBe('test');
      expect(state.initSession?.description).toBe('desc');
      expect(state.initSession?.session_id).toBe('init-abc');

      dispose();
    });
  });

  it('case 3: init.start → defensive [init] log line; initSession stays detecting', async () => {
    fetchSnapshotMock.mockResolvedValue(greenfieldSnapshot());
    postInitMock.mockResolvedValue({
      initialized: true,
      root: '/tmp/proj',
      files: ['.swt-planning/PROJECT.md'],
      session_id: 'init-abc',
    });

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.bootstrap();
      await actions.initProject({ name: 'test', description: 'desc' });

      actions.applyEvent({
        type: 'init.start',
        ts: '2026-05-15T10:00:01Z',
        session_id: 'init-abc',
        name: 'test',
        description: 'desc',
      });

      expect(state.initSession?.status).toBe('detecting');
      // The defensive log line — `[init]` prefix, mirrors the server JSONL.
      const hasInitLogLine = state.recentLogLines.some((l) => /\[init\]/i.test(l.line));
      expect(hasInitLogLine).toBe(true);

      dispose();
    });
  });

  it('case 4: init.complete → is_initialized flips + initSession clears + log line', async () => {
    fetchSnapshotMock.mockResolvedValue(greenfieldSnapshot());
    postInitMock.mockResolvedValue({
      initialized: true,
      root: '/tmp/proj',
      files: ['.swt-planning/PROJECT.md'],
      session_id: 'init-abc',
    });

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.bootstrap();
      await actions.initProject({ name: 'test', description: 'desc' });
      actions.applyEvent({
        type: 'init.start',
        ts: '2026-05-15T10:00:01Z',
        session_id: 'init-abc',
        name: 'test',
      });

      actions.applyEvent({
        type: 'init.complete',
        ts: '2026-05-15T10:00:30Z',
        session_id: 'init-abc',
        status: 'success',
      });

      expect(state.snapshot?.is_initialized).toBe(true);
      expect(state.initSession).toBeNull();
      // The bootstrap-complete log line — accepts either "[init] Lead
      // bootstrap complete" verbatim or any `[init]` + "complete" pair.
      const hasCompleteLogLine = state.recentLogLines.some(
        (l) => /bootstrap complete/i.test(l.line) || /\[init\].*complete/i.test(l.line),
      );
      expect(hasCompleteLogLine).toBe(true);

      dispose();
    });
  });

  it('case 5: init.error → status=error + errorMessage set + state.errors non-empty + is_initialized still false', async () => {
    fetchSnapshotMock.mockResolvedValue(greenfieldSnapshot());
    postInitMock.mockResolvedValue({
      initialized: true,
      root: '/tmp/proj',
      files: ['.swt-planning/PROJECT.md'],
      session_id: 'init-abc',
    });

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.bootstrap();
      await actions.initProject({ name: 'test', description: 'desc' });

      actions.applyEvent({
        type: 'init.error',
        ts: '2026-05-15T10:00:30Z',
        session_id: 'init-abc',
        code: 'INIT_SPAWN_FAILED',
        message: 'subprocess crashed',
      });

      expect(state.initSession?.status).toBe('error');
      expect(state.initSession?.errorMessage).toBe('subprocess crashed');
      expect(state.errors.length).toBeGreaterThan(0);
      // The pushError format is `${code}: ${message}` — confirm both
      // ingredients made it onto the queue.
      expect(state.errors.at(-1)?.message).toContain('INIT_SPAWN_FAILED');
      expect(state.errors.at(-1)?.message).toContain('subprocess crashed');
      // Critical: is_initialized must stay false. init.error does NOT
      // flip it, so InitScreen stays mounted and the user can resubmit.
      expect(state.snapshot?.is_initialized).toBe(false);

      dispose();
    });
  });

  it('case 6: error-rollback re-submit → initSession resets to detecting with fresh session_id, errorMessage cleared', async () => {
    fetchSnapshotMock.mockResolvedValue(greenfieldSnapshot());
    // First call returns the first session id; the second call returns a
    // fresh one. The store consumes them in submission order.
    postInitMock
      .mockResolvedValueOnce({
        initialized: true,
        root: '/tmp/proj',
        files: ['.swt-planning/PROJECT.md'],
        session_id: 'init-abc',
      })
      .mockResolvedValueOnce({
        initialized: true,
        root: '/tmp/proj',
        files: ['.swt-planning/PROJECT.md'],
        session_id: 'init-xyz',
      });

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.bootstrap();
      // First submission → init.error.
      await actions.initProject({ name: 'test', description: 'desc' });
      actions.applyEvent({
        type: 'init.error',
        ts: '2026-05-15T10:00:30Z',
        session_id: 'init-abc',
        code: 'INIT_SPAWN_FAILED',
        message: 'subprocess crashed',
      });
      // Sanity check before the rollback re-submit.
      expect(state.initSession?.status).toBe('error');
      expect(state.initSession?.session_id).toBe('init-abc');

      // Second submission — user retries after seeing the error.
      await actions.initProject({ name: 'test', description: 'desc' });

      expect(state.initSession?.status).toBe('detecting');
      expect(state.initSession?.errorMessage).toBeUndefined();
      expect(state.initSession?.session_id).toBe('init-xyz');
      // The previous session id is gone — full replace, no merge.
      expect(state.initSession?.session_id).not.toBe('init-abc');

      dispose();
    });
  });

  it('case 7: full happy-path transition chain greenfield → detecting → init.start → init.complete → ready', async () => {
    fetchSnapshotMock.mockResolvedValue(greenfieldSnapshot());
    postInitMock.mockResolvedValue({
      initialized: true,
      root: '/tmp/proj',
      files: ['.swt-planning/PROJECT.md'],
      session_id: 'init-abc',
    });

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.bootstrap();

      // T0 — greenfield.
      expect(state.snapshot?.is_initialized).toBe(false);
      expect(state.initSession).toBeNull();

      // T1 — POST /api/init resolves; initSession.status = 'detecting'.
      await actions.initProject({ name: 'test', description: 'desc' });
      expect(state.initSession?.status).toBe('detecting');
      expect(state.snapshot?.is_initialized).toBe(false);

      // T2 — init.start arrives; status stays detecting, log line lands.
      actions.applyEvent({
        type: 'init.start',
        ts: '2026-05-15T10:00:01Z',
        session_id: 'init-abc',
        name: 'test',
      });
      expect(state.initSession?.status).toBe('detecting');

      // T3 — init.complete arrives; is_initialized flips true,
      // initSession clears.
      actions.applyEvent({
        type: 'init.complete',
        ts: '2026-05-15T10:00:30Z',
        session_id: 'init-abc',
        status: 'success',
      });
      expect(state.snapshot?.is_initialized).toBe(true);
      expect(state.initSession).toBeNull();
      // App.tsx's `<Show when={isInitialized()}>` flips to the truthy
      // branch — InitScreen unmounts, dashboard grid mounts.

      dispose();
    });
  });
});
