import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';

import type {
  PhaseSnapshot,
  QaRemediationSnapshot,
  UatRemediationSnapshot,
  UatSnapshot,
  VerificationSnapshot,
} from './types.js';

const PHASE_DIR_RE = /^(\d{2})-(.+)$/;

/**
 * Walk `<planningDir>/phases/` and return one PhaseSnapshot per directory,
 * sorted ascending by leading two-digit position. Missing directories return
 * an empty array (this is not an error — it just means there are no phases
 * yet, which the caller can interpret as `phase_count=0`).
 */
export async function scanPhases(planningDir: string): Promise<readonly PhaseSnapshot[]> {
  const phasesDir = join(planningDir, 'phases');
  let entries: string[];
  try {
    entries = await readdir(phasesDir);
  } catch (err) {
    if (isFileNotFound(err)) return [];
    throw err;
  }

  const matches: { position: string; slug: string; name: string }[] = [];
  for (const entry of entries) {
    const m = PHASE_DIR_RE.exec(entry);
    if (m === null) continue;
    const position = m[1];
    const slug = m[2];
    if (position === undefined || slug === undefined) continue;
    const fullPath = join(phasesDir, entry);
    const st = await stat(fullPath).catch(() => undefined);
    if (st === undefined || !st.isDirectory()) continue;
    matches.push({ position, slug, name: entry });
  }
  matches.sort((a, b) => a.position.localeCompare(b.position));

  const snapshots: PhaseSnapshot[] = [];
  for (const { position, slug, name } of matches) {
    snapshots.push(await snapshotPhase(join(phasesDir, name), position, slug));
  }
  return snapshots;
}

async function snapshotPhase(dir: string, position: string, slug: string): Promise<PhaseSnapshot> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (!isFileNotFound(err)) throw err;
  }

  const planRe = new RegExp(`^${position}-\\d{2}-PLAN\\.md$`);
  const summaryRe = new RegExp(`^${position}-\\d{2}-SUMMARY\\.md$`);
  const verificationRe = new RegExp(`^${position}-VERIFICATION\\.md$`);
  const uatRe = new RegExp(`^${position}-UAT\\.md$`);
  const contextName = `${position}-CONTEXT.md`;
  const researchRe = new RegExp(`^${position}(-\\d{2})?-RESEARCH\\.md$`);

  let planCount = 0;
  let summaryCount = 0;
  let hasContext = false;
  let hasResearch = false;
  let verificationFile: string | undefined;
  let uatFile: string | undefined;

  for (const e of entries) {
    if (planRe.test(e)) planCount += 1;
    if (summaryRe.test(e)) summaryCount += 1;
    if (e === contextName) hasContext = true;
    if (researchRe.test(e)) hasResearch = true;
    if (verificationRe.test(e)) verificationFile = e;
    if (uatRe.test(e)) uatFile = e;
  }

  const verification = verificationFile
    ? await readVerification(join(dir, verificationFile))
    : undefined;
  const uat = uatFile ? await readUat(join(dir, uatFile)) : undefined;

  return {
    position,
    slug,
    dir,
    hasContext,
    hasResearch,
    planCount,
    summaryCount,
    verification,
    uat,
    qaRemediation: await readQaRemediation(dir),
    uatRemediation: await readUatRemediation(dir),
  };
}

async function readVerification(path: string): Promise<VerificationSnapshot> {
  const filename = pathBasename(path);
  try {
    const raw = await readFile(path, 'utf8');
    const { frontmatter } = parseFrontmatter(raw);
    const result = (typeof frontmatter.result === 'string' ? frontmatter.result : '').toUpperCase();
    return {
      filename,
      result: result === 'PASS' || result === 'FAIL' || result === 'PARTIAL' ? result : 'unknown',
      verifiedAtCommit:
        typeof frontmatter.verified_at_commit === 'string'
          ? frontmatter.verified_at_commit
          : undefined,
    };
  } catch {
    return { filename, result: 'unknown', verifiedAtCommit: undefined };
  }
}

async function readUat(path: string): Promise<UatSnapshot> {
  const filename = pathBasename(path);
  try {
    const raw = await readFile(path, 'utf8');
    const { frontmatter } = parseFrontmatter(raw);
    const status = (typeof frontmatter.status === 'string' ? frontmatter.status : '').toLowerCase();
    return {
      filename,
      status:
        status === 'in_progress' || status === 'complete' || status === 'issues_found'
          ? status
          : 'unknown',
      major_or_higher:
        Boolean(frontmatter.major_or_higher) ||
        (typeof frontmatter.severity === 'string' &&
          /^(major|critical|blocker)/i.test(frontmatter.severity)),
    };
  } catch {
    return { filename, status: 'unknown', major_or_higher: false };
  }
}

async function readQaRemediation(dir: string): Promise<QaRemediationSnapshot | undefined> {
  const stagePath = join(dir, '.qa-remediation-stage');
  try {
    const raw = await readFile(stagePath, 'utf8');
    const stageLine = raw.split('\n').find((l) => l.startsWith('stage='));
    const roundLine = raw.split('\n').find((l) => l.startsWith('round='));
    const stage = stageLine?.split('=')[1]?.trim();
    const round = roundLine?.split('=')[1]?.trim() ?? '00';
    if (stage === 'plan' || stage === 'execute' || stage === 'verify' || stage === 'done') {
      return { stage, round };
    }
    return { stage: 'none', round };
  } catch (err) {
    if (isFileNotFound(err)) return undefined;
    throw err;
  }
}

async function readUatRemediation(dir: string): Promise<UatRemediationSnapshot | undefined> {
  const stagePath = join(dir, '.uat-remediation-stage');
  try {
    const raw = await readFile(stagePath, 'utf8');
    const stageLine = raw.split('\n').find((l) => l.startsWith('stage='));
    const roundLine = raw.split('\n').find((l) => l.startsWith('round='));
    const layoutLine = raw.split('\n').find((l) => l.startsWith('layout='));
    const stage = stageLine?.split('=')[1]?.trim();
    const round = roundLine?.split('=')[1]?.trim() ?? '00';
    const layoutValue = layoutLine?.split('=')[1]?.trim() ?? 'round-dir';
    const layout: UatRemediationSnapshot['layout'] =
      layoutValue === 'legacy' ? 'legacy' : 'round-dir';
    if (
      stage === 'research' ||
      stage === 'plan' ||
      stage === 'execute' ||
      stage === 'fix' ||
      stage === 'done'
    ) {
      return { stage, round, layout };
    }
    return { stage: 'none', round, layout };
  } catch (err) {
    if (isFileNotFound(err)) return undefined;
    throw err;
  }
}

function isFileNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

function pathBasename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}
