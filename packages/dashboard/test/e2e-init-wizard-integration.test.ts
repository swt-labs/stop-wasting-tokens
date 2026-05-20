/**
 * Milestone 23 Phase 04 Plan 04-01 T01 — Pattern B store-level E2E
 * integration tests for the init-wizard lifecycle composed across Phase 01
 * (server scaffold), Phase 02 (wizard UI state machine), and Phase 03
 * (mapping affordance).
 *
 * Pattern B (mocked api + sse + direct createDashboardStore) — no real
 * Hono daemon, no real subprocess, no filesystem I/O, no Solid component
 * rendering. SSE events are pumped via `actions.applyEvent(...)` directly,
 * which is the same function the bootstrap wires as the `onEvent`
 * callback. The mock list mirrors `e2e-greenfield-init-smoke.test.ts` so
 * any api.ts export the store may dispatch in this flow lands on a vi.fn()
 * indirection (silent `undefined` returns at runtime are the failure mode
 * Phase 04 Drift 1 closes for the sister smoke file).
 *
 * Acceptance Criteria covered:
 *
 *   - AC 25 (Greenfield E2E) — `bootstrap()` greenfield → `initProject()`
 *     resolves → `init.complete` SSE → `is_initialized` flips → the
 *     `CodebaseMapPrompt` banner stays hidden (`shouldShowMapPrompt` is
 *     false for greenfield) AND `state.isMappingCodebase` stays false.
 *
 *   - AC 26 (Brownfield E2E) — `bootstrap()` brownfield → `initProject()`
 *     resolves with `brownfield:true` → `init.complete` SSE → `state.changed`
 *     pumps `brownfield:true, codebase_mapped:false` → banner trigger
 *     flips true → `startCodebaseMap()` → `postMap` called +
 *     `isMappingCodebase` flips true → `state.changed` with
 *     `codebase_mapped:true` → flag clears, banner hides.
 *
 *   - AC 27 (409 already-initialized E2E) — `postInit` rejects with
 *     `ApiError('already initialized', 409)` → store catches + pushes
 *     onto `state.errors` + re-throws → `is_initialized` stays false +
 *     `initSession` cleared. (The component-level recovery affordance —
 *     `setStep(2) + setErrorKind('already-initialized')` inside
 *     InitScreen.tsx — is owned by Phase 02 unit tests per PA-2.)
 *
 *   - AC 31 (Vendor-agnostic runtime invariant) — explicit assertion that
 *     `state.tools.providerAuth.data` is NEVER mutated by the init flow.
 *     Complements the Phase 02 type-lock at runtime: the wizard + store
 *     read no provider-auth tools-cell data during init.
 *
 *   - In-parent-repo edge case — `bootstrap()` with a snapshot the daemon
 *     would emit when running inside a parent monorepo (the wizard's
 *     Step 1 reads `git: 'parent_repo'` from `/api/init-precheck`, but
 *     the store-level surface is the same `brownfield_detected` snapshot
 *     flag); assert the store accepts the snapshot without error and the
 *     init flow still progresses.
 *
 * PA-3 (Drift 2 — two-field design): the brownfield AC 26 test
 * distinguishes `brownfield_detected` (PRE-INIT, set by the snapshotter
 * before scaffold) from `brownfield` (POST-INIT, set by the snapshotter
 * from `.swt-planning/stack.json`). They are NOT renames of each other;
 * the test pumps each at the right stage of the lifecycle.
 *
 * PA-4 (fetchInitPrecheck — out of scope): the wizard's Step 1 calls
 * `fetchInitPrecheck` inside a `createResource`, which is component-local.
 * Pattern B exercises store actions directly (no Solid render), so
 * `fetchInitPrecheck` is not invoked here and not listed in the mock.
 */

import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchSnapshotMock = vi.fn();
const postInitMock = vi.fn();
const postMapMock = vi.fn();
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
  postMap: (...args: unknown[]) => postMapMock(...args),
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
  // ApiError is consumed below via the explicit import from the same module
  // path; vi.mock replaces the *module*, so we re-export the real class here.
  // Using a getter pattern so the actual class can be required lazily; this
  // matches the e2e-greenfield-smoke.test.ts convention where the symbolic
  // mock surface re-exports the named class.
  ApiError: class ApiError extends Error {
    override readonly name = 'ApiError';
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  },
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

import { ApiError } from '../src/client/services/api.js';
import { shouldShowMapPrompt } from '../src/client/components/CodebaseMapPrompt.js';
import { createDashboardStore } from '../src/client/state/dashboard-store.js';

beforeEach(() => {
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Minimal SnapshotSchema-shaped greenfield base. `state.changed` merges
 * `{...prev, ...partial}`, so bootstrap() needs a non-null base in place
 * before any subsequent merge can take effect. The greenfield/brownfield
 * differences are expressed via the optional `brownfield_detected` /
 * `brownfield` / `codebase_mapped` fields layered on top.
 */
function buildSnapshot(
  overrides: Partial<{
    is_initialized: boolean;
    brownfield_detected: boolean;
    brownfield: boolean;
    codebase_mapped: boolean;
  }> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    schema_version: '1',
    generated_at: '2026-05-20T10:00:00Z',
    project: null,
    milestone: null,
    phases: [],
    recent_events: [],
    active_agents: [],
    cost_summary: null,
    is_initialized: overrides.is_initialized ?? false,
  };
  if (overrides.brownfield_detected !== undefined) {
    base.brownfield_detected = overrides.brownfield_detected;
  }
  if (overrides.brownfield !== undefined) {
    base.brownfield = overrides.brownfield;
  }
  if (overrides.codebase_mapped !== undefined) {
    base.codebase_mapped = overrides.codebase_mapped;
  }
  return base;
}

/**
 * Minimal InitResponse shape (Phase 01's `InitResponseSchema`). Tests pass
 * the parsed shape through `postInitMock.mockResolvedValue(...)`; the store
 * reads `(response as {session_id?: string}).session_id` via a soft cast
 * (Zod-strip in production), so we add `session_id` here for parity with
 * `e2e-greenfield-init-smoke.test.ts`.
 */
function buildInitResponse(
  overrides: Partial<{
    brownfield: boolean;
    git_initialized: boolean;
    stack: ReadonlyArray<string>;
  }> = {},
): Record<string, unknown> {
  return {
    initialized: true as const,
    root: '/tmp/proj',
    files: ['.swt-planning/PROJECT.md'],
    brownfield: overrides.brownfield ?? false,
    git_initialized: overrides.git_initialized ?? true,
    stack: overrides.stack ?? [],
    session_id: 'init-abc',
  };
}

describe('e2e: init wizard integration (milestone 23 Phase 04 Plan 04-01)', () => {
  describe('AC 25 — Greenfield: no banner, no map, vendor-agnostic', () => {
    it('greenfield init completes without triggering the CodebaseMapPrompt banner OR mapping action', async () => {
      fetchSnapshotMock.mockResolvedValue(
        buildSnapshot({
          is_initialized: false,
          brownfield_detected: false,
          brownfield: false,
          codebase_mapped: false,
        }),
      );
      postInitMock.mockResolvedValue(
        buildInitResponse({ brownfield: false, git_initialized: true, stack: [] }),
      );

      await createRoot(async (dispose) => {
        const [state, actions] = createDashboardStore();
        await actions.bootstrap();

        // Pre-init: vendor-agnostic invariant baseline (AC 31). Capture the
        // post-bootstrap providerAuth shape — bootstrap fires
        // `refreshToolsCell('providerAuth')` in greenfield (alpha.43 fix)
        // so the cell's `.data` reflects whatever `fetchProviderAuthMock`
        // returned (`undefined` for the unconfigured vi.fn()). The AC 31
        // invariant is that the INIT FLOW does not mutate this cell;
        // bootstrap-time fetches are out of scope.
        const providerAuthBeforeInit = state.tools.providerAuth.data;

        // Wizard collects {name, planning_tracking, auto_push} in Step 2 and
        // calls actions.initProject({...}). The wizard does NOT pass any
        // provider_id (AC 30 / Locked Decision #10).
        await actions.initProject({
          name: 'proj',
          planning_tracking: 'manual',
          auto_push: 'never',
        });

        // After postInit resolves the store flips to 'detecting' awaiting
        // the SSE init.complete (Phase 01 ships the synchronous scaffold
        // path; the SSE event arrives ~immediately).
        expect(state.initSession?.status).toBe('detecting');
        expect(state.snapshot?.is_initialized).toBe(false);

        // init.start arrives — defensive log line; state stays detecting.
        actions.applyEvent({
          type: 'init.start',
          ts: '2026-05-20T10:00:01Z',
          session_id: 'init-abc',
          name: 'proj',
        });
        expect(state.initSession?.status).toBe('detecting');

        // init.complete arrives — is_initialized flips; initSession clears.
        actions.applyEvent({
          type: 'init.complete',
          ts: '2026-05-20T10:00:02Z',
          session_id: 'init-abc',
          status: 'success',
        });
        expect(state.snapshot?.is_initialized).toBe(true);
        expect(state.initSession).toBeNull();

        // PA-3 (Drift 2) — the snapshotter would now emit state.changed
        // carrying the POST-INIT brownfield/codebase_mapped flags. For
        // greenfield, both stay false.
        actions.applyEvent({
          type: 'state.changed',
          ts: '2026-05-20T10:00:03Z',
          changed: ['phase'],
          snapshot: { brownfield: false, codebase_mapped: false },
        });

        // CodebaseMapPrompt banner trigger: false on greenfield, always.
        expect(shouldShowMapPrompt(state.snapshot)).toBe(false);
        expect(state.isMappingCodebase).toBe(false);

        // AC 31 — providerAuth tools cell was never mutated by the init
        // flow (compare against the post-bootstrap baseline captured above).
        expect(state.tools.providerAuth.data).toBe(providerAuthBeforeInit);
        expect(postMapMock).not.toHaveBeenCalled();

        dispose();
      });
    });
  });

  describe('AC 26 — Brownfield: full banner lifecycle (show → click → mapping → clear)', () => {
    it('brownfield init shows banner, startCodebaseMap dispatches postMap, codebase_mapped clears banner', async () => {
      // PA-3 — `brownfield_detected:true` is the PRE-INIT signal the
      // wizard's Step 1 reads; the daemon's pre-init snapshotter sets it
      // from detect-brownfield.ts. Seed bootstrap() with that flag so the
      // wizard would render the brownfield Step 1 copy (the actual copy
      // rendering is unit-tested in init-screen.test.ts).
      fetchSnapshotMock.mockResolvedValue(
        buildSnapshot({
          is_initialized: false,
          brownfield_detected: true,
          brownfield: false,
          codebase_mapped: false,
        }),
      );
      postInitMock.mockResolvedValue(
        buildInitResponse({
          brownfield: true,
          git_initialized: false,
          stack: ['typescript', 'react'],
        }),
      );
      postMapMock.mockResolvedValue({
        session_id: 'map-abc-def',
        pid: 99000,
        started_at: '2026-05-20T10:01:00.000Z',
      });

      await createRoot(async (dispose) => {
        const [state, actions] = createDashboardStore();
        await actions.bootstrap();

        // Pre-init snapshot carries `brownfield_detected:true` — the
        // wizard would render the brownfield copy. Banner not yet visible
        // (is_initialized still false).
        expect(state.snapshot?.brownfield_detected).toBe(true);
        expect(shouldShowMapPrompt(state.snapshot)).toBe(false);

        await actions.initProject({
          name: 'proj',
          planning_tracking: 'manual',
          auto_push: 'never',
        });

        // init.complete arrives — is_initialized flips.
        actions.applyEvent({
          type: 'init.complete',
          ts: '2026-05-20T10:00:02Z',
          session_id: 'init-abc',
          status: 'success',
        });
        expect(state.snapshot?.is_initialized).toBe(true);

        // PA-3 — the snapshotter's POST-INIT `state.changed` lands carrying
        // `brownfield:true` (from .swt-planning/stack.json existence) +
        // `codebase_mapped:false` (no .swt-planning/codebase/ yet).
        actions.applyEvent({
          type: 'state.changed',
          ts: '2026-05-20T10:00:03Z',
          changed: ['phase'],
          snapshot: { brownfield: true, codebase_mapped: false },
        });

        // Banner trigger fires — all four shouldShowMapPrompt conditions
        // are now met (snapshot present, is_initialized:true, brownfield:
        // true, codebase_mapped:false).
        expect(shouldShowMapPrompt(state.snapshot)).toBe(true);
        expect(state.isMappingCodebase).toBe(false);

        // User clicks "Map codebase" → store's startCodebaseMap action
        // POSTs /api/map and flips the in-flight flag.
        const result = await actions.startCodebaseMap();
        expect(result).toEqual({ ok: true });
        expect(postMapMock).toHaveBeenCalledTimes(1);
        expect(state.isMappingCodebase).toBe(true);

        // Snapshotter's chokidar watcher sees .swt-planning/codebase/ written;
        // buildSnapshot flips `codebase_mapped:true`; SSE state.changed
        // carries the partial. The store's handler clears isMappingCodebase
        // AND merges the partial into the snapshot.
        actions.applyEvent({
          type: 'state.changed',
          ts: '2026-05-20T10:04:00Z',
          changed: ['artifacts'],
          snapshot: { codebase_mapped: true },
        });
        expect(state.isMappingCodebase).toBe(false);
        expect(state.snapshot?.codebase_mapped).toBe(true);

        // Banner unmounts (shouldShowMapPrompt now false on
        // codebase_mapped:true).
        expect(shouldShowMapPrompt(state.snapshot)).toBe(false);

        dispose();
      });
    });

    it('startCodebaseMap is idempotent — repeated clicks while in flight do not double-dispatch postMap', async () => {
      fetchSnapshotMock.mockResolvedValue(
        buildSnapshot({
          is_initialized: true,
          brownfield: true,
          codebase_mapped: false,
        }),
      );
      // postMap resolves quickly; the in-flight flag is the gate, not the
      // promise resolution. The action sets isMappingCodebase=true BEFORE
      // awaiting postMap, so a second call inside the same microtask is
      // already gated.
      postMapMock.mockResolvedValue({
        session_id: 'map-abc',
        pid: 99000,
        started_at: '2026-05-20T10:01:00.000Z',
      });

      await createRoot(async (dispose) => {
        const [state, actions] = createDashboardStore();
        await actions.bootstrap();

        expect(shouldShowMapPrompt(state.snapshot)).toBe(true);

        // First click — kicks the action.
        const p1 = actions.startCodebaseMap();
        // Second click — guarded by `state.isMappingCodebase === true`.
        const p2 = actions.startCodebaseMap();
        const [r1, r2] = await Promise.all([p1, p2]);

        expect(r1).toEqual({ ok: true });
        expect(r2).toEqual({ ok: true });
        expect(postMapMock).toHaveBeenCalledTimes(1);

        dispose();
      });
    });
  });

  describe('AC 27 — 409 already-initialized: store-level error path', () => {
    it('postInit rejecting with ApiError(409) pushes onto state.errors and re-throws; is_initialized stays false', async () => {
      fetchSnapshotMock.mockResolvedValue(
        buildSnapshot({ is_initialized: false, brownfield_detected: false }),
      );
      postInitMock.mockRejectedValue(new ApiError('already initialized', 409));

      await createRoot(async (dispose) => {
        const [state, actions] = createDashboardStore();
        await actions.bootstrap();

        // Action re-throws after pushError per Phase 02 spec.
        await expect(
          actions.initProject({
            name: 'proj',
            planning_tracking: 'manual',
            auto_push: 'never',
          }),
        ).rejects.toThrow(/already initialized/i);

        // Snapshot is_initialized stayed false — no optimistic flip.
        expect(state.snapshot?.is_initialized).toBe(false);

        // pushError was called — the store's `pushError(`init failed:
        // ${message}`)` prepended the prefix.
        expect(state.errors.length).toBeGreaterThan(0);
        expect(state.errors.at(-1)?.message).toMatch(/init failed/i);
        expect(state.errors.at(-1)?.message).toContain('already initialized');

        // initSession was cleared by the catch arm (initSession=null
        // path of the action, not the 'error' state which is reserved
        // for init.error SSE events post-submit).
        expect(state.initSession).toBeNull();

        // The component-level recovery affordance — `setStep(2) +
        // setErrorKind('already-initialized')` — is type-locked at the
        // Phase 02 init-screen.test.ts unit level (PA-2 / Drift 5
        // caveat). The integration test stops at the store boundary.

        dispose();
      });
    });
  });

  describe('AC 31 — vendor-agnostic runtime invariant', () => {
    it('init flow never mutates state.tools.providerAuth (Locked Decision #10 runtime gate)', async () => {
      fetchSnapshotMock.mockResolvedValue(
        buildSnapshot({ is_initialized: false, brownfield_detected: false }),
      );
      postInitMock.mockResolvedValue(buildInitResponse({ brownfield: false }));

      await createRoot(async (dispose) => {
        const [state, actions] = createDashboardStore();
        await actions.bootstrap();

        // Capture the providerAuth cell shape BEFORE the init flow.
        const before = {
          data: state.tools.providerAuth.data,
          loading: state.tools.providerAuth.loading,
          error: state.tools.providerAuth.error,
        };

        await actions.initProject({
          name: 'proj',
          planning_tracking: 'manual',
          auto_push: 'never',
        });
        actions.applyEvent({
          type: 'init.complete',
          ts: '2026-05-20T10:00:02Z',
          session_id: 'init-abc',
          status: 'success',
        });

        const after = {
          data: state.tools.providerAuth.data,
          loading: state.tools.providerAuth.loading,
          error: state.tools.providerAuth.error,
        };

        // .data is the load-bearing field — the wizard never reads provider
        // credentials. .loading + .error are write-side ToolsCell fields the
        // refresh helpers manage, NOT the init flow. The init flow MUST NOT
        // mutate `after.data` relative to `before.data` (captured after
        // bootstrap so the post-bootstrap greenfield providerAuth fetch is
        // not conflated with init-flow mutation).
        expect(after.data).toBe(before.data);

        dispose();
      });
    });
  });

  describe('In-parent-repo edge case', () => {
    it('store accepts a snapshot from a project running inside a parent git monorepo without error', async () => {
      // The wizard's Step 1 reads `git: 'parent_repo'` from
      // `/api/init-precheck`, a component-local createResource. The
      // store-level surface here uses brownfield_detected as the parent-
      // repo proxy (init-precheck's `git` field doesn't replicate onto
      // the SSE snapshot — the wizard's Step 1 copy is rendered by
      // `describeGitState()` which is unit-tested in init-screen.test.ts).
      // What we DO assert here: the store doesn't throw on snapshots
      // emitted while running inside a parent repo, and the init flow
      // still progresses through to is_initialized:true.
      fetchSnapshotMock.mockResolvedValue(
        buildSnapshot({
          is_initialized: false,
          brownfield_detected: true,
          brownfield: false,
          codebase_mapped: false,
        }),
      );
      postInitMock.mockResolvedValue(
        buildInitResponse({ brownfield: true, git_initialized: false, stack: ['typescript'] }),
      );

      await createRoot(async (dispose) => {
        const [state, actions] = createDashboardStore();
        await actions.bootstrap();

        // bootstrap succeeded without throwing.
        expect(state.snapshot?.brownfield_detected).toBe(true);

        // Init still progresses through the synchronous-scaffold path.
        await expect(
          actions.initProject({
            name: 'proj',
            planning_tracking: 'manual',
            auto_push: 'never',
          }),
        ).resolves.toBeTruthy();

        actions.applyEvent({
          type: 'init.complete',
          ts: '2026-05-20T10:00:02Z',
          session_id: 'init-abc',
          status: 'success',
        });
        expect(state.snapshot?.is_initialized).toBe(true);

        dispose();
      });
    });
  });
});
