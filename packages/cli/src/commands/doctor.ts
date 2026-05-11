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

export interface DoctorReport {
  readonly node: string;
  readonly codex: CodexVersionLike | undefined;
  readonly planningDirExists: boolean;
}

export interface DoctorDeps {
  readonly node?: () => string;
  readonly codex?: () => Promise<CodexVersionLike | undefined>;
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
