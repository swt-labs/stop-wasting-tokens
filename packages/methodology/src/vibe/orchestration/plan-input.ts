import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';

export interface PlanInput {
  readonly phase: string; // "01"
  readonly slug: string;
  readonly phaseDir: string;
  readonly goal: string;
  readonly mustHaves: readonly string[];
  readonly research: string | undefined;
  readonly contextNotes: string | undefined;
  readonly existingPlans: readonly { plan: string; title: string }[];
}

export interface ResolvePlanInputOptions {
  readonly planningDir: string;
  readonly phase: string;
  readonly slug: string;
  /** Optional override for the per-phase goal. Falls back to ROADMAP.md / CONTEXT.md. */
  readonly goalOverride?: string;
  /** Optional override for the must-haves list. Falls back to ROADMAP.md success criteria. */
  readonly mustHavesOverride?: readonly string[];
}

/**
 * Read everything Plan mode needs to construct a plan: the per-phase CONTEXT,
 * RESEARCH, and the existing PLAN.md files (so re-runs are idempotent).
 */
export async function resolvePlanInput(opts: ResolvePlanInputOptions): Promise<PlanInput> {
  const phaseDir = join(opts.planningDir, 'phases', `${opts.phase}-${opts.slug}`);
  const goalFromContext = await tryReadPhaseGoal(phaseDir, opts.phase);
  const research = await tryRead(join(phaseDir, `${opts.phase}-RESEARCH.md`));
  const contextNotes = await tryRead(join(phaseDir, `${opts.phase}-CONTEXT.md`));
  const existingPlans = await listExistingPlans(phaseDir, opts.phase);
  const goalFromRoadmap = await tryReadGoalFromRoadmap(opts.planningDir, opts.phase);
  const goal = opts.goalOverride ?? goalFromContext ?? goalFromRoadmap ?? 'Goal not yet set.';

  let mustHaves = opts.mustHavesOverride;
  if (mustHaves === undefined) {
    mustHaves = await tryReadMustHavesFromRoadmap(opts.planningDir, opts.phase);
  }

  return {
    phase: opts.phase,
    slug: opts.slug,
    phaseDir,
    goal,
    mustHaves: mustHaves ?? [],
    research,
    contextNotes,
    existingPlans,
  };
}

async function tryRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function tryReadPhaseGoal(phaseDir: string, phase: string): Promise<string | undefined> {
  const ctx = await tryRead(join(phaseDir, `${phase}-CONTEXT.md`));
  if (ctx === undefined) return undefined;
  const m = /^\*\*Goal:\*\*\s+(.+)\s*$/m.exec(ctx);
  return m?.[1]?.trim();
}

async function tryReadGoalFromRoadmap(
  planningDir: string,
  phase: string,
): Promise<string | undefined> {
  const roadmap = await tryRead(join(planningDir, 'ROADMAP.md'));
  if (roadmap === undefined) return undefined;
  const re = new RegExp(
    `^##\\s+Phase ${parseInt(phase, 10)}:[^\\n]+\\n[\\s\\S]*?\\*\\*Goal:\\*\\*\\s+(.+)\\s*$`,
    'm',
  );
  const m = re.exec(roadmap);
  return m?.[1]?.trim();
}

async function tryReadMustHavesFromRoadmap(
  planningDir: string,
  phase: string,
): Promise<readonly string[] | undefined> {
  const roadmap = await tryRead(join(planningDir, 'ROADMAP.md'));
  if (roadmap === undefined) return undefined;
  const sectionRe = new RegExp(
    `^##\\s+Phase ${parseInt(phase, 10)}:[\\s\\S]*?(?=^##\\s+Phase \\d|^---\\s*$)`,
    'm',
  );
  const section = sectionRe.exec(roadmap)?.[0];
  if (section === undefined) return undefined;
  const block = /\*\*Success Criteria:\*\*[\s\S]*?(?=\n\n|\n\*\*|\n##|$)/m.exec(section);
  if (block === null) return undefined;
  const items = block[0]
    .split('\n')
    .filter((l) => /^-\s+/.test(l))
    .map((l) => l.replace(/^-\s+/, '').trim());
  return items.length === 0 ? undefined : items;
}

async function listExistingPlans(
  phaseDir: string,
  phase: string,
): Promise<readonly { plan: string; title: string }[]> {
  let entries: string[];
  try {
    entries = await readdir(phaseDir);
  } catch {
    return [];
  }
  const planRe = new RegExp(`^${phase}-(\\d{2})-PLAN\\.md$`);
  const out: { plan: string; title: string }[] = [];
  for (const e of entries) {
    const m = planRe.exec(e);
    if (m === null) continue;
    const planId = m[1] ?? '';
    if (planId === '') continue;
    const raw = await tryRead(join(phaseDir, e));
    let title = `Plan ${planId}`;
    if (raw !== undefined) {
      const fm = parseFrontmatter<{ title?: string }>(raw).frontmatter;
      if (typeof fm.title === 'string' && fm.title.length > 0) title = fm.title;
    }
    out.push({ plan: planId, title });
  }
  out.sort((a, b) => a.plan.localeCompare(b.plan));
  return out;
}
