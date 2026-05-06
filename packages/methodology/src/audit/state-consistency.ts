import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';

export interface StateConsistencyResult {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

export interface RunStateConsistencyOptions {
  readonly planningDir: string;
}

export async function runStateConsistencyCheck(
  opts: RunStateConsistencyOptions,
): Promise<StateConsistencyResult> {
  const failures: string[] = [];

  const phasesDir = join(opts.planningDir, 'phases');
  const phaseDirs = await listPhaseDirs(phasesDir);

  const stateRaw = await tryRead(join(opts.planningDir, 'STATE.md'));
  if (stateRaw.length > 0) {
    const declared = extractPhaseCount(stateRaw);
    if (declared !== undefined && declared !== phaseDirs.length) {
      failures.push(
        `STATE.md declares phase_count=${declared}; .swt-planning/phases/ has ${phaseDirs.length}`,
      );
    }
  }

  for (const p of phaseDirs) {
    const dir = join(phasesDir, p);
    const phasePos = phasePosition(p);
    const planRe = new RegExp(`^${phasePos}-(\\d{2})-PLAN\\.md$`);
    const summaryRe = new RegExp(`^${phasePos}-(\\d{2})-SUMMARY\\.md$`);
    const entries = await tryReaddir(dir);
    const planIds = new Set<string>();
    const summaryIds = new Set<string>();
    for (const e of entries) {
      const planMatch = planRe.exec(e);
      if (planMatch !== null) planIds.add(planMatch[1] ?? '');
      const summaryMatch = summaryRe.exec(e);
      if (summaryMatch !== null) summaryIds.add(summaryMatch[1] ?? '');
    }
    for (const id of planIds) {
      if (!summaryIds.has(id)) {
        failures.push(`${p}: PLAN ${id} has no SUMMARY`);
      }
    }
    for (const id of summaryIds) {
      if (!planIds.has(id)) {
        failures.push(`${p}: SUMMARY ${id} has no PLAN`);
      }
    }
    for (const e of entries) {
      if (!summaryRe.test(e)) continue;
      const raw = await readFile(join(dir, e), 'utf8');
      const fm = parseFrontmatter<{ status?: string }>(raw).frontmatter;
      const status = String(fm.status ?? '').toLowerCase();
      if (status !== 'complete') {
        failures.push(`${p}/${e}: status=${status || 'missing'}`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

function extractPhaseCount(stateRaw: string): number | undefined {
  const match = /Phase\s*:\s*\d+\s*of\s*(\d+)/i.exec(stateRaw);
  if (match !== null) {
    const n = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
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
