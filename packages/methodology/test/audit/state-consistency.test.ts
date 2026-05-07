import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runStateConsistencyCheck } from '../../src/audit/state-consistency.js';

let planningDir: string;

beforeEach(async () => {
  planningDir = await mkdtemp(join(tmpdir(), 'swt-state-consistency-'));
  await mkdir(join(planningDir, 'phases', '01-setup'), { recursive: true });
});

afterEach(async () => {
  await rm(planningDir, { recursive: true, force: true });
});

async function seedState(declaredCount: number): Promise<void> {
  await writeFile(
    join(planningDir, 'STATE.md'),
    ['# State', '', '## Current Phase', `Phase: 1 of ${declaredCount}`, 'Status: ready'].join('\n'),
    'utf8',
  );
}

async function seedPlanSummary(plan: string, summaryStatus = 'complete'): Promise<void> {
  const dir = join(planningDir, 'phases', '01-setup');
  await writeFile(
    join(dir, `01-${plan}-PLAN.md`),
    '---\nphase: "01"\nplan: "01"\n---\n# x\n',
    'utf8',
  );
  await writeFile(
    join(dir, `01-${plan}-SUMMARY.md`),
    `---\nphase: "01"\nplan: "${plan}"\nstatus: ${summaryStatus}\n---\n`,
    'utf8',
  );
}

describe('runStateConsistencyCheck', () => {
  it('passes when phase_count matches and every PLAN/SUMMARY pair is complete', async () => {
    await seedState(1);
    await seedPlanSummary('01');
    const out = await runStateConsistencyCheck({ planningDir });
    expect(out.ok).toBe(true);
  });

  it('flags drift when STATE.md declares more phases than exist on disk', async () => {
    await seedState(3);
    await seedPlanSummary('01');
    const out = await runStateConsistencyCheck({ planningDir });
    expect(out.ok).toBe(false);
    expect(out.failures.join('\n')).toContain('phase_count=3');
  });

  it('flags an orphan PLAN with no SUMMARY', async () => {
    await seedState(1);
    await writeFile(
      join(planningDir, 'phases', '01-setup', '01-01-PLAN.md'),
      '---\nphase: "01"\n---\n',
      'utf8',
    );
    const out = await runStateConsistencyCheck({ planningDir });
    expect(out.ok).toBe(false);
    expect(out.failures.join('\n')).toContain('PLAN 01 has no SUMMARY');
  });

  it('flags a SUMMARY whose status is not complete', async () => {
    await seedState(1);
    await seedPlanSummary('01', 'partial');
    const out = await runStateConsistencyCheck({ planningDir });
    expect(out.ok).toBe(false);
    expect(out.failures.join('\n')).toMatch(/01-01-SUMMARY\.md: status=partial/);
  });
});
