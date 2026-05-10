import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { DoctorCheck, DoctorReport } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

import { detectCodexVersion, type CodexVersion } from '../lib/detect-codex.js';

const REQUIRED_NODE_MAJOR = 20;

/**
 * Defaults match the CLI's `swt doctor` command at packages/cli/src/commands/
 * doctor.ts so the dashboard report stays in lockstep with the terminal.
 * Allowed-verbs.ts establishes the precedent for hand-mirrored CLI surface
 * inside the dashboard package; same convention applies here.
 */
export interface DoctorDeps {
  readonly node?: () => string;
  readonly codex?: () => Promise<CodexVersion | undefined>;
  readonly stat?: (path: string) => Promise<unknown>;
}

interface RawDoctorReport {
  readonly node: string;
  readonly codex: CodexVersion | undefined;
  readonly planningDirExists: boolean;
}

async function buildRawReport(cwd: string, deps: DoctorDeps): Promise<RawDoctorReport> {
  const nodeFn = deps.node ?? ((): string => process.versions.node);
  const codexFn = deps.codex ?? ((): Promise<CodexVersion | undefined> => detectCodexVersion());
  const statFn = deps.stat ?? ((p: string): Promise<unknown> => stat(p));
  const node = nodeFn();
  const codex = await codexFn();
  let planningDirExists = false;
  try {
    await statFn(join(cwd, '.swt-planning'));
    planningDirExists = true;
  } catch {
    planningDirExists = false;
  }
  return { node, codex, planningDirExists };
}

/**
 * Project the simple `{node, codex, planningDirExists}` shape into the
 * structured per-check report the dashboard panel renders. Three checks:
 *
 *  - `node-version`: pass when major ≥ 20, warn otherwise.
 *  - `codex-cli`: pass when present, warn when missing (codex isn't strictly
 *    required for read-only dashboard usage, but most workflows need it).
 *  - `planning-dir`: pass when `.swt-planning/` exists, warn otherwise.
 *    Greenfield is intentional, not a fail — the InitScreen handles that flow.
 *
 * `overall_status` is `pass` only when every check passes; `fail` if any
 * fails; otherwise `warn`.
 */
function projectReport(raw: RawDoctorReport): DoctorReport {
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number.parseInt(raw.node.split('.')[0] ?? '0', 10);
  const nodeOk = nodeMajor >= REQUIRED_NODE_MAJOR;
  checks.push({
    id: 'node-version',
    name: `Node ≥ ${REQUIRED_NODE_MAJOR}`,
    status: nodeOk ? 'pass' : 'warn',
    detail: nodeOk
      ? `Node ${raw.node}`
      : `Node ${raw.node} — SWT requires Node ${REQUIRED_NODE_MAJOR} or newer`,
  });

  if (raw.codex !== undefined) {
    checks.push({
      id: 'codex-cli',
      name: 'Codex CLI on PATH',
      status: 'pass',
      detail: `Codex CLI ${raw.codex.version}`,
    });
  } else {
    checks.push({
      id: 'codex-cli',
      name: 'Codex CLI on PATH',
      status: 'warn',
      detail: 'Codex CLI not found — install via the Codex docs to unlock vibe sessions',
    });
  }

  checks.push({
    id: 'planning-dir',
    name: '.swt-planning/ present',
    status: raw.planningDirExists ? 'pass' : 'warn',
    detail: raw.planningDirExists
      ? '.swt-planning/ found in cwd'
      : '.swt-planning/ missing — run `swt init` (or use the InitScreen)',
  });

  const overall_status: DoctorReport['overall_status'] = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';

  return {
    checks,
    overall_status,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Registers `GET /api/doctor`. Mirrors the data the CLI's `swt doctor`
 * surfaces, but reshapes it into per-check rows the dashboard panel
 * renders directly.
 *
 * `deps` is the same injection seam the CLI uses (`packages/cli/src/
 * commands/doctor.ts`) — tests stub the codex check, the stat call, and
 * the node version. Production defaults call the real `detectCodexVersion`
 * from `@swt-labs/codex-driver`.
 */
export function registerDoctorRoute(app: Hono, cwd: string, deps: DoctorDeps = {}): void {
  app.get('/api/doctor', async (c) => {
    try {
      const raw = await buildRawReport(cwd, deps);
      return c.json(projectReport(raw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'doctor_check_failed', detail: message }, 500);
    }
  });
}
