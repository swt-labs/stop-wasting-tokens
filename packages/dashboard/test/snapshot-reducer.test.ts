import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SnapshotSchema } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import { snapshotsEqual } from '../src/server/snapshot/diff.js';
import { buildSnapshot } from '../src/server/snapshot/reducer.js';

function setupFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-snap-'));
  const planning = path.join(root, '.swt-planning');
  mkdirSync(planning, { recursive: true });

  writeFileSync(
    path.join(planning, 'PROJECT.md'),
    '# fixture-project\n\nThe fixture project for snapshot reducer tests.\n',
  );
  writeFileSync(
    path.join(planning, 'STATE.md'),
    [
      '# State',
      '',
      '**Project:** fixture-project',
      '**Milestone:** v1.6.0 Test Milestone',
      '',
      '## Current Phase',
      'Phase: 2 of 4 (Test)',
      'Plans: 0/1',
      'Progress: 25%',
      'Status: ready',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(planning, 'ROADMAP.md'),
    [
      '# fixture-project Roadmap',
      '',
      '**Goal:** smoke',
      '',
      '## Phase 1: First Phase',
      '',
      '**Goal:** First phase goal text.',
      '',
      '**Requirements:** REQ-01',
      '',
      '## Phase 2: Second Phase',
      '',
      '**Goal:** Second phase goal text.',
      '',
      '**Requirements:** REQ-02',
      '',
    ].join('\n'),
  );

  const phasesDir = path.join(planning, 'phases');
  mkdirSync(path.join(phasesDir, '01-first-phase'), { recursive: true });
  mkdirSync(path.join(phasesDir, '02-second-phase'), { recursive: true });

  // Phase 1: complete with a passing UAT (state should be 'all_done', qa 'passed')
  writeFileSync(
    path.join(phasesDir, '01-first-phase', '01-01-PLAN.md'),
    '---\nphase: "01"\nplan: "01"\ntitle: First\n---\n# Plan\n',
  );
  writeFileSync(
    path.join(phasesDir, '01-first-phase', '01-01-SUMMARY.md'),
    '---\nphase: "01"\nstatus: complete\n---\n# Summary\n',
  );
  writeFileSync(
    path.join(phasesDir, '01-first-phase', '01-VERIFICATION.md'),
    '---\nphase: 01\nresult: PASS\n---\n# Verify\n',
  );
  writeFileSync(
    path.join(phasesDir, '01-first-phase', '01-UAT.md'),
    '---\nphase: 01\nstatus: complete\n---\n# UAT\n',
  );

  // Phase 2: only a plan (state should be 'needs_execute', qa 'none')
  writeFileSync(
    path.join(phasesDir, '02-second-phase', '02-01-PLAN.md'),
    '---\nphase: "02"\nplan: "01"\ntitle: Second\n---\n# Plan\n',
  );

  return root;
}

describe('buildSnapshot', () => {
  it('produces a Zod-valid Snapshot from a fixture .swt-planning/ tree', () => {
    const root = setupFixture();
    const snap = buildSnapshot(root);
    SnapshotSchema.parse(snap); // throws if invalid
    expect(snap.schema_version).toBe('1');
    expect(snap.project.name).toBe('fixture-project');
    expect(snap.project.root).toBe(root);
    expect(snap.project.backend).toBe('pi');
    expect(snap.milestone.name).toBe('v1.6.0 Test Milestone');
    expect(snap.milestone.phase_count).toBe(2);
    expect(snap.milestone.phase_index).toBe(2);
    expect(snap.phases).toHaveLength(2);
  });

  it('classifies phase states correctly', () => {
    const root = setupFixture();
    const snap = buildSnapshot(root);
    const p1 = snap.phases.find((p) => p.position === '01');
    const p2 = snap.phases.find((p) => p.position === '02');
    expect(p1?.state).toBe('all_done');
    expect(p1?.qa_status).toBe('passed');
    expect(p2?.state).toBe('needs_execute');
    expect(p2?.qa_status).toBe('none');
  });

  it('extracts phase goals from ROADMAP.md', () => {
    const root = setupFixture();
    const snap = buildSnapshot(root);
    const p1 = snap.phases.find((p) => p.position === '01');
    expect(p1?.goal).toBe('First phase goal text.');
  });

  it('lists artifacts with kind classification', () => {
    const root = setupFixture();
    const snap = buildSnapshot(root);
    const p1 = snap.phases.find((p) => p.position === '01');
    expect(p1?.artifacts.map((a) => a.kind).sort()).toEqual(
      ['plan', 'summary', 'uat', 'verification'].sort(),
    );
  });

  it('returns empty phases array for greenfield projects (no phases dir)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'swt-snap-empty-'));
    mkdirSync(path.join(root, '.swt-planning'), { recursive: true });
    writeFileSync(
      path.join(root, '.swt-planning', 'STATE.md'),
      '# State\n**Project:** greenfield\n**Milestone:** none\n',
    );
    const snap = buildSnapshot(root);
    expect(snap.phases).toEqual([]);
    expect(snap.project.name).toBe('greenfield');
  });

  it('populates phase.plans from PLAN.md frontmatter (Plan 04-02 T2)', () => {
    const root = setupFixture();
    const snap = buildSnapshot(root);
    const p1 = snap.phases.find((p) => p.position === '01');
    expect(p1?.plans).toBeDefined();
    expect(p1?.plans?.[0]?.plan).toBe('01-01');
    expect(p1?.plans?.[0]?.title).toBe('First');
  });

  it('emits empty active_agents[] when no .sessions/ dir exists', () => {
    const root = setupFixture();
    const snap = buildSnapshot(root);
    expect(snap.active_agents).toEqual([]);
  });

  it('populates active_agents from .swt-planning/.sessions/*.json (Plan 04-02 T2)', () => {
    const root = setupFixture();
    const sessDir = path.join(root, '.swt-planning', '.sessions');
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(
      path.join(sessDir, 'sub-alpha.json'),
      JSON.stringify({
        pid: 4321,
        role: 'dev',
        status: 'running',
        sub_session_id: 'sub-alpha',
        started_at: '2026-05-13T08:00:00.000Z',
      }),
    );
    const snap = buildSnapshot(root);
    expect(snap.active_agents).toHaveLength(1);
    expect(snap.active_agents[0]?.sub_session_id).toBe('sub-alpha');
    expect(snap.active_agents[0]?.role).toBe('dev');
    expect(snap.active_agents[0]?.status).toBe('running');
    expect(snap.active_agents[0]?.pid).toBe(4321);
  });

  it('rolls up cost_summary from .swt-planning/.metrics/ (Plan 04-02 T2)', () => {
    const root = setupFixture();
    const metricsDir = path.join(root, '.swt-planning', '.metrics');
    mkdirSync(metricsDir, { recursive: true });
    writeFileSync(
      path.join(metricsDir, 'session-aaa.json'),
      JSON.stringify({
        session_id: 'aaa',
        phase_slug: '02-second-phase',
        agent_results: 1,
        tokens: { in: 100, out: 50, cache_creation: 10, cache_read: 200 },
        cost_usd: 0.42,
        cache_hit_ratio: 0,
        last_updated: new Date().toISOString(),
      }),
    );
    const snap = buildSnapshot(root);
    expect(snap.cost_summary).not.toBeNull();
    expect(snap.cost_summary?.total_usd).toBeCloseTo(0.42, 5);
    expect(snap.cost_summary?.today_usd).toBeCloseTo(0.42, 5);
    expect(snap.cost_summary?.tokens?.cache_read).toBe(200);
    // cache hit ratio = 200 / (100 + 10 + 200) = ~0.645
    expect(snap.cost_summary?.cache_hit_ratio).toBeGreaterThan(0.6);
  });

  it('extracts project description + codebase profile + milestone todos (Plan 04-02 T2)', () => {
    const root = setupFixture();
    writeFileSync(
      path.join(root, '.swt-planning', 'PROJECT.md'),
      [
        '# fixture',
        '',
        '**Description:** Test fixture project',
        '**Stack:** TypeScript / Node',
        '**Languages:** ts, js',
        '**LOC:** 12345',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(root, '.swt-planning', 'STATE.md'),
      [
        '# State',
        '**Project:** fixture-project',
        '**Milestone:** v1.6.0 Test Milestone',
        'Phase: 2 of 2',
        '',
        '**Todos:**',
        '- 04 wire frontend',
        '- ship docs',
        '',
        '**Blockers:**',
        '- 03 pi gap',
        '',
      ].join('\n'),
    );
    const snap = buildSnapshot(root);
    expect(snap.project.description).toBe('Test fixture project');
    expect(snap.project.codebase_profile?.stack).toBe('TypeScript / Node');
    expect(snap.project.codebase_profile?.languages).toEqual(['ts', 'js']);
    expect(snap.project.codebase_profile?.loc).toBe(12345);
    expect(snap.milestone.todos).toEqual([
      { text: 'wire frontend', phase: '04' },
      { text: 'ship docs' },
    ]);
    expect(snap.milestone.blockers).toEqual([{ text: 'pi gap', phase: '03' }]);
  });

  it('computes milestone.percent_complete > 0 once a phase passes (Plan 04-02 T2)', () => {
    const root = setupFixture();
    const snap = buildSnapshot(root);
    // Phase 1 in fixture is all_done with QA pass; phase 2 only has a plan.
    // Expected: (1 + 0.4) / 2 = 0.7
    expect(snap.milestone.percent_complete).toBeGreaterThan(0.5);
    expect(snap.milestone.percent_complete).toBeLessThan(1);
  });

  it('reducer perf <50ms on the fixture (warm)', () => {
    const root = setupFixture();
    buildSnapshot(root); // warm
    const start = performance.now();
    buildSnapshot(root);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

describe('snapshotsEqual', () => {
  it('returns true for two snapshots that differ only in generated_at', () => {
    const root = setupFixture();
    const a = buildSnapshot(root);
    // Force a distinct timestamp — Date.now() resolves to ms and two calls in
    // the same ms collide. The test's point is `snapshotsEqual` ignores
    // `generated_at`; we synthesize the diff so the equality assertion
    // exercises the timestamp-ignoring path deterministically.
    const b = { ...buildSnapshot(root), generated_at: '2099-12-31T23:59:59.999Z' };
    expect(a.generated_at).not.toBe(b.generated_at);
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it('returns false when phase artifacts differ', () => {
    const root = setupFixture();
    const a = buildSnapshot(root);
    writeFileSync(
      path.join(root, '.swt-planning', 'phases', '02-second-phase', '02-01-SUMMARY.md'),
      '---\nphase: "02"\nstatus: complete\n---\n# Summary\n',
    );
    const b = buildSnapshot(root);
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it('handles null inputs', () => {
    expect(snapshotsEqual(null, null)).toBe(true);
    const root = setupFixture();
    const a = buildSnapshot(root);
    expect(snapshotsEqual(null, a)).toBe(false);
    expect(snapshotsEqual(a, null)).toBe(false);
  });
});
