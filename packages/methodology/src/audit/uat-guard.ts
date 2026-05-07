import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';

export interface RunArchiveUatGuardOptions {
  readonly planningDir: string;
}

export interface UatGuardResult {
  readonly status: 'pass' | 'fail';
  readonly failures: readonly string[];
}

/**
 * Hard UAT gate. Scans every active phase + every phase under the latest
 * milestone (excluding `.remediated` markers) and fails when any UAT.md
 * has `status: issues_found` or unresolved issues. Non-bypassable.
 */
export async function runArchiveUatGuard(opts: RunArchiveUatGuardOptions): Promise<UatGuardResult> {
  const failures: string[] = [];

  const activePhasesDir = join(opts.planningDir, 'phases');
  for (const f of await scan(activePhasesDir, '')) failures.push(f);

  const milestoneDir = await latestMilestone(opts.planningDir);
  if (milestoneDir !== undefined) {
    const milestonePhasesDir = join(opts.planningDir, 'milestones', milestoneDir, 'phases');
    for (const f of await scan(milestonePhasesDir, `${milestoneDir}/`)) failures.push(f);
  }

  return { status: failures.length > 0 ? 'fail' : 'pass', failures };
}

async function scan(phasesDir: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(phasesDir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const m = /^(\d{2})-/.exec(e);
    if (m === null) continue;
    const phasePos = m[1] ?? '';
    const phaseDir = join(phasesDir, e);
    const remediated = await fileExists(join(phaseDir, '.remediated'));
    if (remediated) continue;
    const uatPath = join(phaseDir, `${phasePos}-UAT.md`);
    let raw: string;
    try {
      raw = await readFile(uatPath, 'utf8');
    } catch {
      continue; // missing UAT is the audit gate's concern, not the guard's
    }
    const fm = parseFrontmatter<{ status?: string; issues?: number }>(raw).frontmatter;
    const status = String(fm.status ?? '').toLowerCase();
    const issues = Number(fm.issues ?? 0);
    if (status === 'issues_found') {
      out.push(`${prefix}${e}: UAT.md status=issues_found`);
    } else if (issues > 0 && status !== 'complete') {
      out.push(`${prefix}${e}: UAT.md issues=${issues}, status=${status || 'unknown'}`);
    }
  }
  return out;
}

async function latestMilestone(planningDir: string): Promise<string | undefined> {
  const milestonesDir = join(planningDir, 'milestones');
  let entries: string[];
  try {
    entries = await readdir(milestonesDir);
  } catch {
    return undefined;
  }
  const dirs: string[] = [];
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const s = await stat(join(milestonesDir, e)).catch(() => undefined);
    if (s !== undefined && s.isDirectory()) dirs.push(e);
  }
  if (dirs.length === 0) return undefined;
  dirs.sort();
  return dirs[dirs.length - 1];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}
