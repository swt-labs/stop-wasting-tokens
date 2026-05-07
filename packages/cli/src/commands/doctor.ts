import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { detectCodexVersion, type CodexVersion } from '@swt-labs/codex-driver';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

export interface DoctorReport {
  readonly node: string;
  readonly codex: CodexVersion | undefined;
  readonly planningDirExists: boolean;
}

export interface DoctorDeps {
  readonly node?: () => string;
  readonly codex?: () => Promise<CodexVersion | undefined>;
  readonly stat?: (path: string) => Promise<unknown>;
}

const REQUIRED_NODE_MAJOR = 20;

export async function buildDoctorReport(cwd: string, deps: DoctorDeps = {}): Promise<DoctorReport> {
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
    const report = await buildDoctorReport(io.cwd, deps);
    io.stdout.write(renderDoctorReport(report));
    return EXIT.SUCCESS;
  };
}
