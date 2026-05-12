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
