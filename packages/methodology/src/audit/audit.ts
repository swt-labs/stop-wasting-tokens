import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';

export type AuditStatus = 'pass' | 'warn' | 'fail';

export interface AuditCheck {
  readonly id: string;
  readonly title: string;
  readonly status: AuditStatus;
  readonly details: readonly string[];
}

export interface AuditResult {
  readonly status: AuditStatus;
  readonly checks: readonly AuditCheck[];
}

export interface RunArchiveAuditOptions {
  readonly planningDir: string;
  readonly skipNonUatChecks?: boolean;
}

const REQ_ID_RE = /^REQ-\d{2,}$/;

export async function runArchiveAudit(opts: RunArchiveAuditOptions): Promise<AuditResult> {
  const checks: AuditCheck[] = [];

  const roadmap = await tryRead(join(opts.planningDir, 'ROADMAP.md'));
  const phasesDir = join(opts.planningDir, 'phases');
  const phases = await listPhaseDirs(phasesDir);

  checks.push(await auditRoadmapCompleteness(roadmap));
  checks.push(await auditPhasePlanning(phasesDir, phases));
  checks.push(await auditPlanExecution(phasesDir, phases));
  checks.push(await auditExecutionStatus(phasesDir, phases));
  checks.push(await auditVerification(phasesDir, phases));
  checks.push(await auditUatStatus(phasesDir, phases));
  const reqs = await tryRead(join(opts.planningDir, 'REQUIREMENTS.md'));
  checks.push(auditRequirementsCoverage(roadmap, reqs));

  let aggregate: AuditStatus = 'pass';
  for (const c of checks) {
    if (c.status === 'fail' && !(opts.skipNonUatChecks && c.id !== 'uat_status')) {
      aggregate = 'fail';
    } else if (c.status === 'warn' && aggregate === 'pass') {
      aggregate = 'warn';
    }
  }
  return { status: aggregate, checks };
}

function auditRoadmapCompleteness(roadmap: string): Promise<AuditCheck> {
  if (roadmap.length === 0) {
    return Promise.resolve({
      id: 'roadmap_completeness',
      title: 'Roadmap completeness',
      status: 'fail',
      details: ['ROADMAP.md missing'],
    });
  }
  const sections = splitPhaseSections(roadmap);
  const missing: string[] = [];
  for (const s of sections) {
    if (!/Goal:\s*\S/i.test(s.body) || /Goal:\s*TBD\b/i.test(s.body)) {
      missing.push(s.heading);
    }
  }
  return Promise.resolve({
    id: 'roadmap_completeness',
    title: 'Roadmap completeness',
    status: missing.length > 0 ? 'fail' : 'pass',
    details: missing.map((h) => `${h} has no concrete Goal`),
  });
}

async function auditPhasePlanning(
  phasesDir: string,
  phases: readonly string[],
): Promise<AuditCheck> {
  const failures: string[] = [];
  for (const p of phases) {
    const dir = join(phasesDir, p);
    const phasePos = phasePosition(p);
    const planRe = new RegExp(`^${phasePos}-\\d{2}-PLAN\\.md$`);
    const entries = await tryReaddir(dir);
    const plans = entries.filter((e) => planRe.test(e));
    if (plans.length === 0) {
      failures.push(`${p}: no PLAN.md files`);
    }
  }
  return {
    id: 'phase_planning',
    title: 'Every phase has at least one PLAN.md',
    status: failures.length > 0 ? 'fail' : 'pass',
    details: failures,
  };
}

async function auditPlanExecution(
  phasesDir: string,
  phases: readonly string[],
): Promise<AuditCheck> {
  const failures: string[] = [];
  for (const p of phases) {
    const dir = join(phasesDir, p);
    const phasePos = phasePosition(p);
    const planRe = new RegExp(`^${phasePos}-(\\d{2})-PLAN\\.md$`);
    const entries = await tryReaddir(dir);
    for (const e of entries) {
      const m = planRe.exec(e);
      if (m === null) continue;
      const planId = m[1] ?? '';
      const summary = `${phasePos}-${planId}-SUMMARY.md`;
      if (!entries.includes(summary)) {
        failures.push(`${p}: ${e} missing matching ${summary}`);
      }
    }
  }
  return {
    id: 'plan_execution',
    title: 'Every PLAN.md has a SUMMARY.md',
    status: failures.length > 0 ? 'fail' : 'pass',
    details: failures,
  };
}

async function auditExecutionStatus(
  phasesDir: string,
  phases: readonly string[],
): Promise<AuditCheck> {
  const failures: string[] = [];
  for (const p of phases) {
    const dir = join(phasesDir, p);
    const phasePos = phasePosition(p);
    const re = new RegExp(`^${phasePos}-\\d{2}-SUMMARY\\.md$`);
    const entries = await tryReaddir(dir);
    for (const e of entries) {
      if (!re.test(e)) continue;
      const raw = await readFile(join(dir, e), 'utf8');
      const fm = parseFrontmatter<{ status?: string }>(raw).frontmatter;
      const status = String(fm.status ?? '').toLowerCase();
      if (status !== 'complete') {
        failures.push(`${p}/${e}: status=${status || 'missing'}`);
      }
    }
  }
  return {
    id: 'execution_status',
    title: 'Every SUMMARY.md has status: complete',
    status: failures.length > 0 ? 'fail' : 'pass',
    details: failures,
  };
}

async function auditVerification(
  phasesDir: string,
  phases: readonly string[],
): Promise<AuditCheck> {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const p of phases) {
    const dir = join(phasesDir, p);
    const phasePos = phasePosition(p);
    const path = join(dir, `${phasePos}-VERIFICATION.md`);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      warnings.push(`${p}: VERIFICATION.md missing`);
      continue;
    }
    const fm = parseFrontmatter<{ result?: string }>(raw).frontmatter;
    const result = String(fm.result ?? '').toLowerCase();
    if (result === 'fail' || result === 'partial') {
      failures.push(`${p}: VERIFICATION result=${result}`);
    } else if (result !== 'pass') {
      warnings.push(`${p}: VERIFICATION result=${result || 'unknown'}`);
    }
  }
  if (failures.length > 0) {
    return {
      id: 'verification',
      title: 'Every phase has fresh PASS VERIFICATION.md',
      status: 'fail',
      details: [...failures, ...warnings],
    };
  }
  if (warnings.length > 0) {
    return {
      id: 'verification',
      title: 'Every phase has fresh PASS VERIFICATION.md',
      status: 'warn',
      details: warnings,
    };
  }
  return {
    id: 'verification',
    title: 'Every phase has fresh PASS VERIFICATION.md',
    status: 'pass',
    details: [],
  };
}

async function auditUatStatus(phasesDir: string, phases: readonly string[]): Promise<AuditCheck> {
  const failures: string[] = [];
  for (const p of phases) {
    const dir = join(phasesDir, p);
    const phasePos = phasePosition(p);
    const path = join(dir, `${phasePos}-UAT.md`);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      failures.push(`${p}: UAT.md missing`);
      continue;
    }
    const fm = parseFrontmatter<{ status?: string; issues?: number }>(raw).frontmatter;
    const status = String(fm.status ?? '').toLowerCase();
    const issues = Number(fm.issues ?? 0);
    if (status === 'issues_found') {
      failures.push(`${p}: UAT.md status=issues_found`);
    } else if (issues > 0 && status !== 'complete') {
      failures.push(`${p}: UAT.md issues=${issues}, status=${status || 'unknown'}`);
    }
  }
  return {
    id: 'uat_status',
    title: 'Every phase has clean UAT.md',
    status: failures.length > 0 ? 'fail' : 'pass',
    details: failures,
  };
}

function auditRequirementsCoverage(roadmap: string, reqs: string): AuditCheck {
  if (reqs.length === 0) {
    return {
      id: 'requirements_coverage',
      title: 'Roadmap REQ-IDs exist in REQUIREMENTS.md',
      status: 'fail',
      details: ['REQUIREMENTS.md missing'],
    };
  }
  const roadmapIds = new Set<string>();
  const m = roadmap.match(/REQ-\d{2,}/g);
  if (m !== null) for (const id of m) roadmapIds.add(id);
  const reqIds = new Set<string>();
  const r = reqs.match(/REQ-\d{2,}/g);
  if (r !== null) for (const id of r) reqIds.add(id);

  const missing = [...roadmapIds].filter((id) => REQ_ID_RE.test(id) && !reqIds.has(id));
  return {
    id: 'requirements_coverage',
    title: 'Roadmap REQ-IDs exist in REQUIREMENTS.md',
    status: missing.length > 0 ? 'fail' : 'pass',
    details: missing.map((id) => `${id} not found in REQUIREMENTS.md`),
  };
}

function splitPhaseSections(raw: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  const lines = raw.split(/\r?\n/);
  let current: { heading: string; body: string[] } | undefined;
  for (const line of lines) {
    const m = /^##\s+Phase\s+\d+:.*/.exec(line);
    if (m !== null) {
      if (current !== undefined)
        out.push({ heading: current.heading, body: current.body.join('\n') });
      current = { heading: line.replace(/^##\s+/, '').trim(), body: [] };
      continue;
    }
    if (current !== undefined) current.body.push(line);
  }
  if (current !== undefined) out.push({ heading: current.heading, body: current.body.join('\n') });
  return out;
}

function phasePosition(name: string): string {
  const m = /^(\d{2})-/.exec(name);
  return m !== null ? (m[1] ?? '00') : '00';
}

async function listPhaseDirs(phasesDir: string): Promise<readonly string[]> {
  const entries = await tryReaddir(phasesDir);
  const out: string[] = [];
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    if (!/^\d{2}-/.test(e)) continue;
    const s = await stat(join(phasesDir, e)).catch(() => undefined);
    if (s !== undefined && s.isDirectory()) out.push(e);
  }
  out.sort();
  return out;
}

async function tryRead(p: string): Promise<string> {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return '';
  }
}

async function tryReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
