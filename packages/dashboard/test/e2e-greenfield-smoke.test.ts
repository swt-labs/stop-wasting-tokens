/**
 * Phase 04 / Plan 04-01 Task 3 — Greenfield smoke test for the cook bar's
 * workflow-state-aware placeholder + hint chain.
 *
 * Two layers of coverage, both fully hermetic (no Hono, no Pi, no API key,
 * no filesystem I/O, no real spawn):
 *
 *   1. PURE-HELPER UNITS — direct invocations of `deriveWorkflowState`
 *      and `firstActivePhasePosition` exported from `App.tsx`, plus the
 *      verbatim placeholder/hint strings from `TopBar.tsx`'s exported
 *      `placeholderForVerb` / `hintForVerb`. These pin the 5-state
 *      matrix (the placeholder + hint pairs that ship in the SPA) at
 *      assertion-time.
 *
 *   2. REACTIVE CHAIN — drives a real `createDashboardStore` through
 *      one full milestone lifecycle (greenfield → scoped_unplanned →
 *      planned_unexecuted → all_done) with cook_running asserted
 *      mid-flight. The store is Pattern B (mocked api + sse + direct
 *      createDashboardStore from `e2e-plan-execute-roundtrip.test.ts`).
 *      Synthetic `state.changed` events carrying SnapshotSchema.partial()
 *      payloads drive the store's snapshot field; `deriveWorkflowState`
 *      is then re-evaluated against the live state at each step. This
 *      exercises the EXACT signal path the App.tsx createMemo subscribes
 *      to, just without rendering the App.
 *
 * Why not render the App? The dashboard workspace has no Solid testing
 * library + the root vitest config runs `environment: 'node'` with no
 * jsdom — same constraint as `topbar.test.ts`. Asserting the memo's
 * pure output against the same store fields is the equivalent contract.
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

// Importing the real `placeholderForVerb` / `hintForVerb` from `TopBar.jsx`
// (the same module path `topbar.test.ts` uses successfully — proves the
// module can be imported under `environment: 'node'` without triggering
// the @corvu/resizable client-only crash).
import { hintForVerb, placeholderForVerb } from '../src/client/components/TopBar.jsx';
import { deriveWorkflowState, firstActivePhasePosition } from '../src/client/lib/workflow-state.js';
import { createDashboardStore } from '../src/client/state/dashboard-store.js';

beforeEach(() => {
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* ── Section 1 — pure-helper unit tests ──────────────────────────────── */

describe('deriveWorkflowState — pure helper (Plan 04-01 T1)', () => {
  it('greenfield: isInitialized=false → "greenfield"', () => {
    expect(
      deriveWorkflowState({
        isInitialized: false,
        phaseCount: 0,
        phases: [],
        vibeSessionStatus: undefined,
      }),
    ).toBe('greenfield');
  });

  it('isInitialized=true but phaseCount=0 (degenerate) → "scoped_unplanned" fallback', () => {
    // Defensive branch: the dashboard should rarely sit in this state
    // because Scope writes phases atomically, but if a snapshot lands
    // between init and the first phase landing the fallback gives the
    // user the "press Enter to plan" affordance instead of falsely
    // claiming the milestone is all_done.
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 0,
        phases: [],
        vibeSessionStatus: undefined,
      }),
    ).toBe('scoped_unplanned');
  });

  it('initialized + cook running → "cook_running" (overrides static phase state)', () => {
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 1,
        phases: [{ state: 'needs_execute', position: '01' }],
        vibeSessionStatus: 'running',
      }),
    ).toBe('cook_running');
  });

  it('phase[0].state=needs_discussion → "scoped_unplanned"', () => {
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 1,
        phases: [{ state: 'needs_discussion', position: '01' }],
        vibeSessionStatus: undefined,
      }),
    ).toBe('scoped_unplanned');
  });

  it('phase[0].state=needs_plan_and_execute → "scoped_unplanned"', () => {
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 1,
        phases: [{ state: 'needs_plan_and_execute', position: '01' }],
        vibeSessionStatus: undefined,
      }),
    ).toBe('scoped_unplanned');
  });

  it('phase[0].state=needs_execute → "planned_unexecuted"', () => {
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 1,
        phases: [{ state: 'needs_execute', position: '01' }],
        vibeSessionStatus: undefined,
      }),
    ).toBe('planned_unexecuted');
  });

  it('phase[0].state=needs_verification → "planned_unexecuted"', () => {
    // needs_verification routes through the same Enter affordance as
    // needs_execute (the next user action is Verify, which the cook bar
    // re-uses Execute mode for).
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 1,
        phases: [{ state: 'needs_verification', position: '01' }],
        vibeSessionStatus: undefined,
      }),
    ).toBe('planned_unexecuted');
  });

  it('phase[0].state=needs_qa_remediation → "planned_unexecuted"', () => {
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 1,
        phases: [{ state: 'needs_qa_remediation', position: '01' }],
        vibeSessionStatus: undefined,
      }),
    ).toBe('planned_unexecuted');
  });

  it('all phases all_done + phaseCount>0 → "all_done"', () => {
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 2,
        phases: [
          { state: 'all_done', position: '01' },
          { state: 'all_done', position: '02' },
        ],
        vibeSessionStatus: undefined,
      }),
    ).toBe('all_done');
  });

  it('phases[0] all_done but phases[1] needs_execute → "planned_unexecuted" (uses first non-done)', () => {
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 2,
        phases: [
          { state: 'all_done', position: '01' },
          { state: 'needs_execute', position: '02' },
        ],
        vibeSessionStatus: undefined,
      }),
    ).toBe('planned_unexecuted');
  });

  it('vibeSessionStatus=completed does NOT override phase state', () => {
    // Only 'running' triggers the cook_running override; 'completed'
    // and 'crashed' let the phase-derived state through (the 10s clear
    // window happens AFTER cook.completion and the user expects to see
    // "Press Enter to plan/execute" the moment the agent finishes).
    expect(
      deriveWorkflowState({
        isInitialized: true,
        phaseCount: 1,
        phases: [{ state: 'needs_execute', position: '01' }],
        vibeSessionStatus: 'completed',
      }),
    ).toBe('planned_unexecuted');
  });
});

describe('firstActivePhasePosition — pure helper (Plan 04-01 T1)', () => {
  it('returns "01" when phases[0] is the first non-done', () => {
    expect(firstActivePhasePosition([{ state: 'needs_execute', position: '01' }])).toBe('01');
  });

  it('skips done phases — returns "02" when phases[0] is all_done', () => {
    expect(
      firstActivePhasePosition([
        { state: 'all_done', position: '01' },
        { state: 'needs_plan_and_execute', position: '02' },
      ]),
    ).toBe('02');
  });

  it('returns null when every phase is all_done', () => {
    expect(
      firstActivePhasePosition([
        { state: 'all_done', position: '01' },
        { state: 'all_done', position: '02' },
      ]),
    ).toBeNull();
  });

  it('returns null when phases array is empty', () => {
    expect(firstActivePhasePosition([])).toBeNull();
  });
});

describe('placeholderForVerb / hintForVerb — Phase 04 cook-verb matrix (Plan 04-01 T2)', () => {
  it('renders the 5-state placeholder matrix verbatim for the cook verb', () => {
    expect(placeholderForVerb('cook', 'greenfield')).toBe('Describe what you want to build');
    expect(placeholderForVerb('cook', 'scoped_unplanned')).toBe(
      'Press Enter to plan the next phase',
    );
    expect(placeholderForVerb('cook', 'planned_unexecuted')).toBe('Press Enter to execute');
    expect(placeholderForVerb('cook', 'cook_running')).toBe('Cook session running…');
    expect(placeholderForVerb('cook', 'all_done')).toBe('Run /vbw:status');
  });

  it('renders the 5-state hint matrix verbatim for the cook verb', () => {
    expect(hintForVerb('cook', 'greenfield')).toBe('↵ scope your first phase');
    expect(hintForVerb('cook', 'scoped_unplanned', '01')).toBe('↵ plan phase 01');
    expect(hintForVerb('cook', 'planned_unexecuted', '02')).toBe('↵ execute phase 02');
    expect(hintForVerb('cook', 'cook_running')).toBe('↵ double-Enter for a new session');
    expect(hintForVerb('cook', 'all_done')).toBe('↵ milestone complete');
  });

  it('falls back to a generic hint when activePhasePosition is null', () => {
    expect(hintForVerb('cook', 'scoped_unplanned', null)).toBe('↵ plan next phase');
    expect(hintForVerb('cook', 'planned_unexecuted', null)).toBe('↵ execute next phase');
  });

  it('falls back to verb-only behaviour when workflowState is undefined (non-Phase-04 callers)', () => {
    // Byte-identical pre-Phase-04 strings — proves the optional second
    // arg is non-breaking for any caller that hasn't been updated.
    expect(placeholderForVerb('cook')).toBe('Describe what you want built…');
    expect(hintForVerb('cook')).toBe('↵ start a cook session');
  });

  it('non-cook verbs ignore workflowState entirely (byte-identical fallback)', () => {
    // Even when workflowState IS provided, non-cook verbs use the
    // verb-only branch — proves the cook-only gate in the if condition.
    expect(placeholderForVerb('research', 'cook_running')).toBe('Topic to research…');
    expect(placeholderForVerb('qa', 'all_done')).toBe('Phase number (optional)…');
    expect(placeholderForVerb('verify', 'greenfield')).toBe('Phase number (optional)…');
    expect(placeholderForVerb('map', 'planned_unexecuted')).toBe('(no input needed)');
    expect(hintForVerb('research', 'greenfield')).toBe('↵ research <your text>');
    expect(hintForVerb('qa', 'all_done')).toBe('↵ run qa (optional phase arg)');
    expect(hintForVerb('verify', 'cook_running')).toBe('↵ run verify (optional phase arg)');
    expect(hintForVerb('map', 'scoped_unplanned')).toBe('↵ run map');
  });
});

/* ── Section 2 — reactive store → memo chain ─────────────────────────── */

/**
 * Build a minimal-but-SnapshotSchema-shaped object for the synthetic
 * `state.changed` event payloads below. Greenfield (`is_initialized:
 * false`) is the default — pass overrides for any field you want to
 * flip.
 *
 * The store's `state.changed` handler merges this object into the
 * existing snapshot via `{...prev, ...partial}` (dashboard-store.ts
 * line ~733). The merge requires the snapshot to already be non-null,
 * which `bootstrap()` guarantees with the `fetchSnapshotMock` initial
 * payload below.
 */
function buildSnapshotPartial(
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

describe('e2e: greenfield → scoped_unplanned → planned_unexecuted → all_done reactive chain', () => {
  it('drives the cook-bar matrix end-to-end through one milestone lifecycle', async () => {
    // The plan walks Scope → Plan → Execute → (final completion) — three
    // startVibeSession calls.
    postCookStartMock
      .mockResolvedValueOnce({
        session_id: 'sess-scope',
        started_at: '2026-05-15T10:00:00Z',
      })
      .mockResolvedValueOnce({
        session_id: 'sess-plan',
        started_at: '2026-05-15T10:05:00Z',
      })
      .mockResolvedValueOnce({
        session_id: 'sess-exec',
        started_at: '2026-05-15T10:10:00Z',
      });
    // Initial snapshot: greenfield (is_initialized=false, no phases).
    // bootstrap() needs SOMETHING in the store so the subsequent
    // state.changed merge has a base object — the partial-merge guard
    // (`if (!prev) return prev`) silently ignores merges into null.
    fetchSnapshotMock.mockResolvedValue({
      schema_version: '1',
      generated_at: '2026-05-15T10:00:00Z',
      project: null,
      milestone: null,
      phases: [],
      recent_events: [],
      active_agents: [],
      cost_summary: null,
      is_initialized: false,
    });

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.bootstrap();

      // T0 — greenfield. Snapshot says is_initialized=false; no vibe
      // session yet.
      expect(state.snapshot?.is_initialized).toBe(false);
      const stateT0 = deriveWorkflowState({
        isInitialized: state.snapshot?.is_initialized ?? false,
        phaseCount: state.snapshot?.milestone?.phase_count ?? 0,
        phases: state.snapshot?.phases ?? [],
        vibeSessionStatus: state.vibeSession?.status,
      });
      expect(stateT0).toBe('greenfield');
      expect(placeholderForVerb('cook', stateT0)).toBe('Describe what you want to build');
      expect(hintForVerb('cook', stateT0)).toBe('↵ scope your first phase');

      // T1 — user types an idea and hits Enter. startVibeSession
      // resolves → vibeSession.status='running'. Until the
      // state.changed event flips is_initialized, the snapshot still
      // says greenfield — but the cook_running override beats
      // is_initialized=false? No: the precedence is greenfield first
      // (is_initialized=false short-circuits). So at this beat the
      // derivation still says 'greenfield' because the daemon has not
      // written `.swt-planning/` yet. The cook_running placeholder
      // only kicks in once the daemon initializes the project.
      //
      // Real flow: cook spawns → writes `.swt-planning/` → emits
      // state.changed → is_initialized flips → cook_running takes
      // over. The plan's T1 assertion expects 'cook_running' AFTER
      // is_initialized=true has propagated. Inject that here so the
      // mid-flight cook_running override is exercised explicitly.
      await actions.startVibeSession('build a snake game');
      expect(state.vibeSession?.status).toBe('running');
      // Daemon writes `.swt-planning/`; state.changed flips is_initialized.
      actions.applyEvent({
        type: 'state.changed',
        ts: '2026-05-15T10:00:30Z',
        changed: ['phase'],
        snapshot: buildSnapshotPartial({ is_initialized: true }),
      });
      const stateT1 = deriveWorkflowState({
        isInitialized: state.snapshot?.is_initialized ?? false,
        phaseCount: state.snapshot?.milestone?.phase_count ?? 0,
        phases: state.snapshot?.phases ?? [],
        vibeSessionStatus: state.vibeSession?.status,
      });
      expect(stateT1).toBe('cook_running');
      expect(placeholderForVerb('cook', stateT1)).toBe('Cook session running…');
      expect(hintForVerb('cook', stateT1)).toBe('↵ double-Enter for a new session');

      // T2 — Scope completes. ROADMAP.md + phase[0] dir landed; phase
      // is `needs_plan_and_execute`. cook.completion flips
      // vibeSession.status to 'completed'. Derivation should be
      // 'scoped_unplanned'.
      actions.applyEvent({
        type: 'state.changed',
        ts: '2026-05-15T10:01:00Z',
        changed: ['phase'],
        snapshot: buildSnapshotPartial({
          is_initialized: true,
          phase_count: 1,
          phases: [{ position: '01', state: 'needs_plan_and_execute' }],
        }),
      });
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-15T10:01:05Z',
        session_id: 'sess-scope',
        status: 'success',
      });
      expect(state.vibeSession?.status).toBe('completed');
      const stateT2 = deriveWorkflowState({
        isInitialized: state.snapshot?.is_initialized ?? false,
        phaseCount: state.snapshot?.milestone?.phase_count ?? 0,
        phases: state.snapshot?.phases ?? [],
        vibeSessionStatus: state.vibeSession?.status,
      });
      expect(stateT2).toBe('scoped_unplanned');
      expect(placeholderForVerb('cook', stateT2)).toBe('Press Enter to plan the next phase');
      const t2Pos = firstActivePhasePosition(state.snapshot?.phases ?? []);
      expect(t2Pos).toBe('01');
      expect(hintForVerb('cook', stateT2, t2Pos)).toBe('↵ plan phase 01');

      // T3 — user hits Enter again; Plan mode runs and writes PLAN.md
      // for phase 01; phase state flips to 'needs_execute'.
      await actions.startVibeSession('plan it');
      actions.applyEvent({
        type: 'state.changed',
        ts: '2026-05-15T10:06:00Z',
        changed: ['phase'],
        snapshot: buildSnapshotPartial({
          is_initialized: true,
          phase_count: 1,
          phases: [{ position: '01', state: 'needs_execute' }],
        }),
      });
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-15T10:06:05Z',
        session_id: 'sess-plan',
        status: 'success',
      });
      const stateT3 = deriveWorkflowState({
        isInitialized: state.snapshot?.is_initialized ?? false,
        phaseCount: state.snapshot?.milestone?.phase_count ?? 0,
        phases: state.snapshot?.phases ?? [],
        vibeSessionStatus: state.vibeSession?.status,
      });
      expect(stateT3).toBe('planned_unexecuted');
      expect(placeholderForVerb('cook', stateT3)).toBe('Press Enter to execute');
      const t3Pos = firstActivePhasePosition(state.snapshot?.phases ?? []);
      expect(t3Pos).toBe('01');
      expect(hintForVerb('cook', stateT3, t3Pos)).toBe('↵ execute phase 01');

      // T4 — user hits Enter a third time; Execute mode runs and
      // flips phase to all_done. Derivation should be 'all_done'.
      await actions.startVibeSession('execute it');
      actions.applyEvent({
        type: 'state.changed',
        ts: '2026-05-15T10:11:00Z',
        changed: ['phase'],
        snapshot: buildSnapshotPartial({
          is_initialized: true,
          phase_count: 1,
          phases: [{ position: '01', state: 'all_done' }],
        }),
      });
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-15T10:11:05Z',
        session_id: 'sess-exec',
        status: 'success',
      });
      const stateT4 = deriveWorkflowState({
        isInitialized: state.snapshot?.is_initialized ?? false,
        phaseCount: state.snapshot?.milestone?.phase_count ?? 0,
        phases: state.snapshot?.phases ?? [],
        vibeSessionStatus: state.vibeSession?.status,
      });
      expect(stateT4).toBe('all_done');
      expect(placeholderForVerb('cook', stateT4)).toBe('Run /vbw:status');
      expect(hintForVerb('cook', stateT4)).toBe('↵ milestone complete');
      // firstActivePhasePosition should report no remaining phase.
      expect(firstActivePhasePosition(state.snapshot?.phases ?? [])).toBeNull();

      dispose();
    });
  });
});
