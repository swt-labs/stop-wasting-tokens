import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { archiveMilestone } from '../src/milestones/archive.js';

let planning: string;

beforeEach(async () => {
  planning = await mkdtemp(join(tmpdir(), 'swt-milestone-'));
  await mkdir(join(planning, 'phases', '01-setup'), { recursive: true });
  await writeFile(join(planning, 'phases', '01-setup', '01-01-PLAN.md'), 'plan-body\n', 'utf8');
  await writeFile(join(planning, 'ROADMAP.md'), '# Roadmap\n', 'utf8');
  await writeFile(
    join(planning, 'STATE.md'),
    `# State\n\n**Project:** swt-test\n\n## Current Phase\nPhase: 1 of 1\n\n## Todos\n- keep me\n\n## Blockers\n_(none)_\n\n## Activity Log\n- shipped\n`,
    'utf8',
  );
});

afterEach(async () => {
  await rm(planning, { recursive: true, force: true });
});

describe('archiveMilestone', () => {
  it('moves ROADMAP and phases into milestones/<slug>/ and rewrites root STATE.md', async () => {
    const result = await archiveMilestone({ planningDir: planning, slug: 'mvp' });
    expect(result.milestoneDir).toBe(join(planning, 'milestones', 'mvp'));

    await expect(stat(join(planning, 'ROADMAP.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(planning, 'phases'))).rejects.toMatchObject({ code: 'ENOENT' });

    const archivedRoadmap = await readFile(join(result.milestoneDir, 'ROADMAP.md'), 'utf8');
    expect(archivedRoadmap).toContain('# Roadmap');
    const archivedPlan = await readFile(
      join(result.milestoneDir, 'phases', '01-setup', '01-01-PLAN.md'),
      'utf8',
    );
    expect(archivedPlan).toContain('plan-body');

    const newState = await readFile(join(planning, 'STATE.md'), 'utf8');
    expect(newState).toContain('**Project:** swt-test');
    expect(newState).toContain('keep me');
    expect(newState).not.toContain('Current Phase');
    expect(newState).not.toContain('shipped');
  });

  it('records a SHIPPED marker with the slug', async () => {
    const result = await archiveMilestone({
      planningDir: planning,
      slug: 'mvp',
      archived_at: '2026-05-06T10:00:00.000Z',
    });
    const shipped = await readFile(result.shippedFile, 'utf8');
    expect(shipped).toContain('# mvp');
    expect(shipped).toContain('Shipped: 2026-05-06T10:00:00.000Z');
  });
});
