import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runArchiveUatGuard } from '../../src/audit/uat-guard.js';

let planningDir: string;

beforeEach(async () => {
  planningDir = await mkdtemp(join(tmpdir(), 'swt-uat-guard-'));
  await mkdir(join(planningDir, 'phases'), { recursive: true });
});

afterEach(async () => {
  await rm(planningDir, { recursive: true, force: true });
});

async function seedActivePhase(name: string, status: string, issues = 0): Promise<void> {
  const dir = join(planningDir, 'phases', name);
  await mkdir(dir, { recursive: true });
  const phasePos = name.split('-')[0] ?? '01';
  await writeFile(
    join(dir, `${phasePos}-UAT.md`),
    `---\nphase: "${phasePos}"\nstatus: ${status}\nissues: ${issues}\n---\n`,
    'utf8',
  );
}

async function seedMilestonePhase(
  milestone: string,
  name: string,
  status: string,
  issues: number,
  remediated = false,
): Promise<void> {
  const dir = join(planningDir, 'milestones', milestone, 'phases', name);
  await mkdir(dir, { recursive: true });
  const phasePos = name.split('-')[0] ?? '01';
  await writeFile(
    join(dir, `${phasePos}-UAT.md`),
    `---\nphase: "${phasePos}"\nstatus: ${status}\nissues: ${issues}\n---\n`,
    'utf8',
  );
  if (remediated) {
    await writeFile(join(dir, '.remediated'), 'acknowledged_at: 2026-05-06\n', 'utf8');
  }
}

describe('runArchiveUatGuard', () => {
  it('passes when active phases are clean and there are no milestones', async () => {
    await seedActivePhase('01-setup', 'complete', 0);
    const out = await runArchiveUatGuard({ planningDir });
    expect(out.status).toBe('pass');
  });

  it('fails when an active phase UAT has status=issues_found', async () => {
    await seedActivePhase('01-setup', 'issues_found', 2);
    const out = await runArchiveUatGuard({ planningDir });
    expect(out.status).toBe('fail');
    expect(out.failures[0]).toContain('01-setup');
  });

  it('fails when a milestone phase UAT has unresolved issues', async () => {
    await seedMilestonePhase('01-old', '01-foundation', 'issues_found', 1);
    const out = await runArchiveUatGuard({ planningDir });
    expect(out.status).toBe('fail');
    expect(out.failures[0]).toContain('01-old/01-foundation');
  });

  it('skips milestone phases that are .remediated', async () => {
    await seedMilestonePhase('01-old', '01-foundation', 'issues_found', 1, true);
    const out = await runArchiveUatGuard({ planningDir });
    expect(out.status).toBe('pass');
  });
});
