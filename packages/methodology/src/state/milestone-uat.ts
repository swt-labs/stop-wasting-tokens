import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';

export interface MilestoneUatPhase {
  /** Absolute path to `<planningDir>/milestones/<slug>/phases/<phase-dir>/`. */
  readonly phaseDir: string;
  readonly phasePosition: string;
  readonly phaseSlug: string;
  readonly milestoneSlug: string;
  readonly status: 'issues_found' | 'in_progress' | 'unknown';
  readonly major_or_higher: boolean;
}

export interface MilestoneUatScan {
  readonly issues: readonly MilestoneUatPhase[];
  readonly major_or_higher: boolean;
}

/**
 * Walk shipped milestones under `<planningDir>/milestones/<slug>/phases/` and
 * collect every phase that has a `*-UAT.md` with status=`issues_found` and no
 * sibling `.remediated` marker.
 */
export async function scanMilestoneUat(planningDir: string): Promise<MilestoneUatScan> {
  const milestonesDir = join(planningDir, 'milestones');
  let milestoneEntries: string[];
  try {
    milestoneEntries = await readdir(milestonesDir);
  } catch (err) {
    if (isFileNotFound(err)) return { issues: [], major_or_higher: false };
    throw err;
  }

  const issues: MilestoneUatPhase[] = [];
  let majorOrHigher = false;

  for (const milestoneSlug of milestoneEntries) {
    const phasesDir = join(milestonesDir, milestoneSlug, 'phases');
    let phaseEntries: string[];
    try {
      phaseEntries = await readdir(phasesDir);
    } catch (err) {
      if (isFileNotFound(err)) continue;
      throw err;
    }

    for (const phaseEntry of phaseEntries) {
      const m = /^(\d{2})-(.+)$/.exec(phaseEntry);
      if (m === null) continue;
      const phaseDir = join(phasesDir, phaseEntry);
      const st = await stat(phaseDir).catch(() => undefined);
      if (st === undefined || !st.isDirectory()) continue;

      const phasePosition = m[1];
      const phaseSlug = m[2];
      if (phasePosition === undefined || phaseSlug === undefined) continue;

      // Skip if already marked remediated.
      const remediatedMarker = join(phaseDir, '.remediated');
      const remediated = await stat(remediatedMarker).catch(() => undefined);
      if (remediated !== undefined) continue;

      // Find a top-level UAT artefact.
      const uatFile = `${phasePosition}-UAT.md`;
      const uatPath = join(phaseDir, uatFile);
      const uatStat = await stat(uatPath).catch(() => undefined);
      if (uatStat === undefined) continue;

      try {
        const raw = await readFile(uatPath, 'utf8');
        const { frontmatter } = parseFrontmatter(raw);
        const status = (typeof frontmatter.status === 'string' ? frontmatter.status : '').toLowerCase();
        if (status !== 'issues_found') continue;
        const isMajor =
          Boolean(frontmatter.major_or_higher) ||
          (typeof frontmatter.severity === 'string' &&
            /^(major|critical|blocker)/i.test(frontmatter.severity));
        if (isMajor) majorOrHigher = true;
        issues.push({
          phaseDir,
          phasePosition,
          phaseSlug,
          milestoneSlug,
          status: status === 'issues_found' ? 'issues_found' : 'unknown',
          major_or_higher: isMajor,
        });
      } catch {
        // Treat unparseable UAT as no issue (fail open).
      }
    }
  }

  return { issues, major_or_higher: majorOrHigher };
}

function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
