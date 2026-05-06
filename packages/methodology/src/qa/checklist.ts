import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';
import type { UatTest } from '@swt-labs/artifacts';

export interface PlanFrontmatter {
  readonly plan: string;
  readonly title: string;
  readonly mustHaves: readonly string[];
}

export interface SynthesizeChecklistOptions {
  readonly phaseDir: string;
  readonly phase: string;
  readonly defaultStatus?: 'pass' | 'fail' | 'skipped' | 'deferred';
}

export interface SynthesizedChecklist {
  readonly plans: readonly PlanFrontmatter[];
  readonly tests: readonly UatTest[];
}

export async function synthesizeUatChecklist(
  opts: SynthesizeChecklistOptions,
): Promise<SynthesizedChecklist> {
  const plans = await readPlans(opts.phaseDir, opts.phase);
  const status = opts.defaultStatus ?? 'deferred';
  const tests: UatTest[] = [];
  for (const plan of plans) {
    plan.mustHaves.forEach((mh, idx) => {
      tests.push({
        id: `P${plan.plan}-MH${(idx + 1).toString().padStart(2, '0')}`,
        description: mh,
        status,
        notes: `Plan ${plan.plan}: ${plan.title}`,
      });
    });
  }
  return { plans, tests };
}

async function readPlans(phaseDir: string, phase: string): Promise<readonly PlanFrontmatter[]> {
  let entries: string[];
  try {
    entries = await readdir(phaseDir);
  } catch {
    return [];
  }
  const planRe = new RegExp(`^${phase}-(\\d{2})-PLAN\\.md$`);
  const out: PlanFrontmatter[] = [];
  for (const e of entries) {
    const m = planRe.exec(e);
    if (m === null) continue;
    const planId = m[1] ?? '';
    if (planId === '') continue;
    const raw = await readFile(join(phaseDir, e), 'utf8');
    const fm = parseFrontmatter<{
      title?: string;
      must_haves?: string[];
    }>(raw).frontmatter;
    out.push({
      plan: planId,
      title: typeof fm.title === 'string' ? fm.title : `Plan ${planId}`,
      mustHaves: Array.isArray(fm.must_haves) ? fm.must_haves : [],
    });
  }
  out.sort((a, b) => a.plan.localeCompare(b.plan));
  return out;
}
