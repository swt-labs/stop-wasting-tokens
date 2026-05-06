import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { synthesizeUatChecklist } from '../../src/qa/checklist.js';

let phaseDir: string;

beforeEach(async () => {
  phaseDir = await mkdtemp(join(tmpdir(), 'swt-checklist-'));
});

afterEach(async () => {
  await rm(phaseDir, { recursive: true, force: true });
});

async function seedPlan(phase: string, plan: string, mustHaves: string[]): Promise<void> {
  const lines = [
    '---',
    `phase: ${phase}`,
    `plan: ${plan}`,
    `title: "Plan ${plan}"`,
    'wave: 1',
    'depends_on: []',
    'must_haves:',
    ...mustHaves.map((mh) => `  - ${JSON.stringify(mh)}`),
    '---',
    `# Plan ${plan}`,
  ];
  await writeFile(join(phaseDir, `${phase}-${plan}-PLAN.md`), lines.join('\n'), 'utf8');
}

describe('synthesizeUatChecklist', () => {
  it('produces one test row per must-have across all PLAN.md files', async () => {
    await seedPlan('01', '01', ['Must A', 'Must B']);
    await seedPlan('01', '02', ['Must C']);

    const result = await synthesizeUatChecklist({ phaseDir, phase: '01' });
    expect(result.plans).toHaveLength(2);
    expect(result.tests).toHaveLength(3);
    expect(result.tests[0]?.id).toBe('P01-MH01');
    expect(result.tests[0]?.description).toBe('Must A');
    expect(result.tests[1]?.id).toBe('P01-MH02');
    expect(result.tests[2]?.id).toBe('P02-MH01');
    for (const t of result.tests) {
      expect(t.status).toBe('deferred');
    }
  });

  it('honors the defaultStatus override', async () => {
    await seedPlan('02', '01', ['One']);
    const result = await synthesizeUatChecklist({
      phaseDir,
      phase: '02',
      defaultStatus: 'pass',
    });
    expect(result.tests[0]?.status).toBe('pass');
  });

  it('returns empty arrays when no plan files exist', async () => {
    await mkdir(join(phaseDir, 'noise'), { recursive: true });
    const result = await synthesizeUatChecklist({ phaseDir, phase: '03' });
    expect(result.plans).toEqual([]);
    expect(result.tests).toEqual([]);
  });
});
