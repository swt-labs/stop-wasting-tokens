import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { SpawnerEnvironment } from '@swt-labs/core';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

/**
 * Local shape kept compatible with the historical `CodexVersion` so the
 * `DoctorReport.codex` field still satisfies `DoctorReportSchema` in
 * `@swt-labs/shared`. PR-01b removes the `@swt-labs/codex-driver` import
 * that previously sourced this type; the runtime probe (PR-02+) populates the
 * field via `DoctorDeps.spawnerEnv` instead.
 */
export interface CodexVersionLike {
  readonly version: string;
}

/**
 * Pi peer-dep status surfaced from the runtime's `SpawnerEnvironment.probe()`.
 * When `available === true`, `version` carries the Pi peer-dep version (e.g.
 * `0.74.0`). When false, `reason` explains why (e.g. `pi peerDep missing`).
 * M2 PR-15 wired this through the doctor command so `swt doctor` makes the
 * Pi installation status visible at a glance.
 */
export interface PiStatusLike {
  readonly available: boolean;
  readonly name: string;
  readonly version?: string;
  readonly reason?: string;
}

export interface DoctorReport {
  readonly node: string;
  readonly codex: CodexVersionLike | undefined;
  readonly pi: PiStatusLike | undefined;
  readonly planningDirExists: boolean;
}

export interface DoctorDeps {
  readonly node?: () => string;
  readonly codex?: () => Promise<CodexVersionLike | undefined>;
  /** Override Pi probe (test seam). When omitted, derived from `spawnerEnv.probe()`. */
  readonly pi?: () => Promise<PiStatusLike | undefined>;
  readonly spawnerEnv?: SpawnerEnvironment;
  readonly stat?: (path: string) => Promise<unknown>;
}

const REQUIRED_NODE_MAJOR = 20;

export async function buildDoctorReport(cwd: string, deps: DoctorDeps = {}): Promise<DoctorReport> {
  const nodeFn = deps.node ?? ((): string => process.versions.node);
  // PR-01b: source-import edge to `@swt-labs/codex-driver` is broken. `deps.codex` stays
  // as the legacy test seam (tests in `cli/test/doctor.test.ts` exercise it); when neither
  // `codex` nor `spawnerEnv` is provided, the default returns `undefined` (i.e., no codex
  // detection from v3). When `spawnerEnv` is provided and its probe reports `name: 'codex'`,
  // its `version` field is surfaced as `codex.version` for dashboard-contract compatibility.
  const codexFn =
    deps.codex ??
    (async (): Promise<CodexVersionLike | undefined> => {
      if (deps.spawnerEnv === undefined) return undefined;
      const probe = await deps.spawnerEnv.probe();
      if (probe.available && probe.name === 'codex' && probe.version !== undefined) {
        return { version: probe.version };
      }
      return undefined;
    });
  // M2 PR-15: surface Pi peer-dep status from `spawnerEnv.probe()`. When the
  // probe reports `name: 'pi-*'`, lift it through to `report.pi`. Tests
  // override via `deps.pi` for deterministic output.
  const piFn =
    deps.pi ??
    (async (): Promise<PiStatusLike | undefined> => {
      if (deps.spawnerEnv === undefined) return undefined;
      const probe = await deps.spawnerEnv.probe();
      if (!probe.name.startsWith('pi-')) return undefined;
      return {
        available: probe.available,
        name: probe.name,
        ...(probe.version !== undefined ? { version: probe.version } : {}),
        ...(probe.reason !== undefined ? { reason: probe.reason } : {}),
      };
    });
  const statFn = deps.stat ?? ((p: string): Promise<unknown> => stat(p));
  const node = nodeFn();
  const codex = await codexFn();
  const pi = await piFn();
  let planningDirExists = false;
  try {
    await statFn(join(cwd, '.swt-planning'));
    planningDirExists = true;
  } catch {
    planningDirExists = false;
  }
  return { node, codex, pi, planningDirExists };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('SWT doctor:');
  const nodeMajor = parseInt(report.node.split('.')[0] ?? '0', 10);
  const nodeOk = nodeMajor >= REQUIRED_NODE_MAJOR;
  lines.push(
    `  ${nodeOk ? '✓' : '⚠'} Node ${report.node}${nodeOk ? '' : ` (need ≥ ${REQUIRED_NODE_MAJOR})`}`,
  );
  if (report.codex !== undefined) {
    lines.push(`  ✓ Codex CLI ${report.codex.version}`);
  } else {
    lines.push('  ⚠ Codex CLI not found on PATH');
  }
  if (report.pi !== undefined) {
    if (report.pi.available && report.pi.version !== undefined) {
      lines.push(`  ✓ Pi runtime ${report.pi.version} (${report.pi.name})`);
    } else {
      lines.push(
        `  ⚠ Pi runtime not available${report.pi.reason !== undefined ? ` — ${report.pi.reason}` : ''}`,
      );
    }
  }
  lines.push(
    report.planningDirExists
      ? '  ✓ .swt-planning/ present'
      : '  ⚠ .swt-planning/ missing — run `swt init`',
  );
  lines.push('');
  return lines.join('\n');
}

export function doctorHandler(deps: DoctorDeps = {}): CommandHandler {
  return async (_parsed, io: CommandIO): Promise<ExitCode> => {
    // Thread the io-supplied SpawnerEnvironment into deps if the caller hasn't already
    // overridden it (preserves test-injectable behavior; production wiring comes from main.ts).
    const finalDeps: DoctorDeps = {
      ...deps,
      ...(deps.spawnerEnv === undefined && io.spawnerEnv !== undefined
        ? { spawnerEnv: io.spawnerEnv }
        : {}),
    };
    const report = await buildDoctorReport(io.cwd, finalDeps);
    io.stdout.write(renderDoctorReport(report));
    return EXIT.SUCCESS;
  };
}
