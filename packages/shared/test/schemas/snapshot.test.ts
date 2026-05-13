import { describe, expect, it } from 'vitest';

import {
  SnapshotSchema,
  type AgentLiveState,
  type PlanSummary,
  type Snapshot,
} from '../../src/schemas/snapshot.js';

/**
 * Plan 04-02 (Phase 4) T1 — Snapshot schema extensions for the 5-pane
 * dashboard. The reducer (T2) populates these fields; this test pins the
 * wire format so dev-04-03 (frontend) can typecheck against it without
 * fighting drift.
 */

const TS = '2026-05-13T10:00:00.000Z';

function baseSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schema_version: '1',
    generated_at: TS,
    project: null,
    milestone: null,
    phases: [],
    active_agents: [],
    recent_events: [],
    cost_summary: null,
    is_initialized: true,
    ...overrides,
  };
}

describe('@swt-labs/shared — Snapshot 04-02 extensions', () => {
  it('parses the minimal default-shaped snapshot', () => {
    const parsed = SnapshotSchema.parse(baseSnapshot());
    expect(parsed.active_agents).toEqual([]);
  });

  it('defaults `active_agents` to [] when the wire frame omits it', () => {
    // The .default([]) shim covers the pre-04-02 → post-04-02 transition.
    const wire: unknown = {
      schema_version: '1',
      generated_at: TS,
      project: null,
      milestone: null,
      phases: [],
      recent_events: [],
      cost_summary: null,
      is_initialized: true,
    };
    const parsed = SnapshotSchema.parse(wire);
    expect(parsed.active_agents).toEqual([]);
  });

  it('accepts a populated active_agents[] entry', () => {
    const agent: AgentLiveState = {
      sub_session_id: 'sub-A',
      role: 'dev',
      model: 'pi-large',
      status: 'running',
      current_tool: 'Read',
      current_tool_input_excerpt: '/etc/passwd',
      tokens_in: 100,
      tokens_out: 50,
      cache_read: 200,
      cache_creation: 10,
      cost_usd: 0.05,
      elapsed_ms: 1234,
      started_at: TS,
      pid: 12345,
    };
    const snap = SnapshotSchema.parse(baseSnapshot({ active_agents: [agent] }));
    expect(snap.active_agents).toHaveLength(1);
    expect(snap.active_agents[0]?.sub_session_id).toBe('sub-A');
  });

  it('accepts cost_summary with the new Pane 4 breakdown', () => {
    const snap = SnapshotSchema.parse(
      baseSnapshot({
        cost_summary: {
          total_usd: 1.23,
          today_usd: 0.4,
          this_milestone_usd: 1.0,
          this_phase_usd: 0.6,
          this_session_usd: 0.2,
          cache_hit_ratio: 0.75,
          tokens: { in: 1000, out: 200, cache_creation: 50, cache_read: 800 },
          budget: { phase_limit_usd: 5, spent_pct: 0.12 },
        },
      }),
    );
    expect(snap.cost_summary?.this_phase_usd).toBe(0.6);
    expect(snap.cost_summary?.cache_hit_ratio).toBe(0.75);
    expect(snap.cost_summary?.tokens?.cache_read).toBe(800);
  });

  it('accepts project.description and codebase_profile (Pane 1)', () => {
    const snap = SnapshotSchema.parse(
      baseSnapshot({
        project: {
          name: 'fixture',
          root: '/tmp/fixture',
          backend: 'pi',
          description: 'A test fixture',
          codebase_profile: { stack: 'TypeScript', languages: ['ts'], loc: 12345 },
        },
      }),
    );
    expect(snap.project?.codebase_profile?.stack).toBe('TypeScript');
  });

  it('accepts milestone.percent_complete + todos + blockers', () => {
    const snap = SnapshotSchema.parse(
      baseSnapshot({
        milestone: {
          name: 'm1',
          phase_count: 4,
          phase_index: 2,
          percent_complete: 0.5,
          todos: [{ text: 'wire frontend', phase: '04' }],
          blockers: [{ text: 'pi gap', phase: '03' }],
        },
      }),
    );
    expect(snap.milestone?.percent_complete).toBe(0.5);
    expect(snap.milestone?.todos?.[0]?.text).toBe('wire frontend');
  });

  it('accepts per-phase plans[] (Pane 2 drill-in)', () => {
    const plan: PlanSummary = {
      plan: '04-02',
      title: 'Dashboard Backend',
      wave: 2,
      status: 'in_progress',
    };
    const snap = SnapshotSchema.parse(
      baseSnapshot({
        phases: [
          {
            position: '04',
            slug: '04-dashboard',
            name: 'Dashboard',
            state: 'needs_execute',
            qa_status: 'none',
            artifacts: [],
            plans: [plan],
          },
        ],
      }),
    );
    expect(snap.phases[0]?.plans?.[0]?.plan).toBe('04-02');
  });

  it('rejects out-of-range cache_hit_ratio', () => {
    const result = SnapshotSchema.safeParse(
      baseSnapshot({
        cost_summary: {
          total_usd: 0,
          today_usd: 0,
          this_milestone_usd: 0,
          cache_hit_ratio: 1.5,
        },
      }),
    );
    expect(result.success).toBe(false);
  });
});
