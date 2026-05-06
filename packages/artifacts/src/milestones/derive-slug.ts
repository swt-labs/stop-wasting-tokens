import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface DeriveSlugOptions {
  readonly planningDir: string;
  /** Override 'today' for deterministic tests. */
  readonly today?: () => string;
}

/**
 * Read ROADMAP.md, extract phase entries, and produce a deterministic milestone
 * slug. Mirrors VBW derive-milestone-slug.sh: numbered kebab-case slug like
 * "01-setup-api-layer". Falls back to "milestone-{date}" when no phases are
 * found or ROADMAP.md is missing.
 */
export async function deriveMilestoneSlug(opts: DeriveSlugOptions): Promise<string> {
  const today = (opts.today ?? defaultToday)();
  let raw: string;
  try {
    raw = await readFile(join(opts.planningDir, 'ROADMAP.md'), 'utf8');
  } catch (err) {
    if (
      typeof err !== 'object' ||
      err === null ||
      (err as { code?: string }).code !== 'ENOENT'
    ) {
      throw err;
    }
    return `milestone-${today}`;
  }

  const phases = extractPhaseHeadings(raw);
  if (phases.length === 0) {
    return `milestone-${today}`;
  }

  const milestoneIndex = await nextMilestoneIndex(opts.planningDir);
  const slugBody = phases.map(kebab).filter((s) => s.length > 0).join('-');
  const truncated = truncate(slugBody, 60);
  const indexPrefix = milestoneIndex.toString().padStart(2, '0');
  return truncated.length > 0 ? `${indexPrefix}-${truncated}` : `${indexPrefix}-milestone`;
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractPhaseHeadings(raw: string): string[] {
  const out: string[] = [];
  const re = /^##\s+Phase\s+\d+:\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1]?.trim() ?? '';
    if (name.length > 0) out.push(name);
  }
  return out;
}

function kebab(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max);
  const lastDash = cut.lastIndexOf('-');
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

async function nextMilestoneIndex(planningDir: string): Promise<number> {
  const milestonesDir = join(planningDir, 'milestones');
  let entries: string[];
  try {
    entries = await readdir(milestonesDir);
  } catch {
    return 1;
  }
  let highest = 0;
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const fullPath = join(milestonesDir, e);
    try {
      const s = await stat(fullPath);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }
    const m = /^(\d{2})-/.exec(e);
    if (m === null) continue;
    const n = Number.parseInt(m[1] ?? '0', 10);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return highest + 1;
}
