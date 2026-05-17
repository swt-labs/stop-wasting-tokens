import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

export interface StubSpec {
  readonly name: string;
  readonly description: string;
  /**
   * Roadmap pointer printed in the stub message so the user knows where
   * the real implementation will land.
   */
  readonly roadmap_phase: string;
}

export function stubCommand(spec: StubSpec): CommandHandler {
  return (_parsed, io: CommandIO): ExitCode => {
    io.stderr.write(
      `swt ${spec.name}: not yet implemented in this build.\n` +
        `  ${spec.description}\n` +
        `  Roadmap: ${spec.roadmap_phase}.\n` +
        `  See .swt-planning/ROADMAP.md for the full plan.\n`,
    );
    return EXIT.NOT_IMPLEMENTED;
  };
}

/**
 * `swt fix` — Plan 06-05 T4: formally deprecated. The verb has no
 * semantically distinct path from `swt cook` (qa/uat remediation routing)
 * or `swt qa` (direct assertion-failure handling). Per Phase 3
 * PARITY-REPORT.md:154-158, fix is replaced by a meaningful migration
 * pointer that exits NOT_IMPLEMENTED (64) so scripts can detect the
 * deprecation without behavior surprise.
 */
export const fixDeprecatedHandler: CommandHandler = (_parsed, io: CommandIO): ExitCode => {
  io.stderr.write(
    `swt fix: deprecated — not a standalone verb in v3.\n` +
      `\n` +
      `  Use one of:\n` +
      `    swt cook        — general qa/uat remediation routing (auto-detects)\n` +
      `    swt qa          — direct assertion-failure handling\n` +
      `\n` +
      `  See .swt-planning/ROADMAP.md for the verb-graduation status.\n`,
  );
  return EXIT.NOT_IMPLEMENTED;
};

export const STUB_SPECS: readonly StubSpec[] = [
  // `init` graduated from stub to real command in v1.7.0; see
  // packages/cli/src/commands/init.ts and main.ts buildRegistry().
  // `plan` graduated to a thin alias in Plan 15-01-01 T2; see
  // packages/cli/src/commands/plan.ts and main.ts buildRegistry().
  // `execute` graduated to a thin alias in Plan 15-01-01 T2; see
  // packages/cli/src/commands/execute.ts and main.ts buildRegistry().
  // `qa` graduated from stub to real command in Plan 03-03 T1; see
  // packages/cli/src/commands/qa.ts and main.ts buildRegistry().
  // `map` graduated from stub to real command in Plan 03-03 T4; see
  // packages/cli/src/commands/map.ts and main.ts buildRegistry().
  // `debug` graduated to a thin shim in Plan 06-05 T4; see
  // packages/cli/src/commands/debug.ts and main.ts buildRegistry().
  // `fix` is registered as a real (deprecated) command in main.ts via
  // fixDeprecatedHandler above — kept out of STUB_SPECS so the message
  // is meaningful instead of generic NOT_IMPLEMENTED scaffolding.
  // `archive` graduated to a thin alias in Plan 15-01-01 T3; see
  // packages/cli/src/commands/archive.ts and main.ts buildRegistry().
  { name: 'release', description: 'Cut a release via Changesets', roadmap_phase: 'Phase 10' },
  { name: 'resume', description: 'Resume a paused session', roadmap_phase: 'Phase 7' },
  { name: 'pause', description: 'Pause and stash session state', roadmap_phase: 'Phase 7' },
  // `audit` graduated to a thin alias in Plan 15-01-01 T3 (maps to cook
  // --archive until a standalone --audit-only cook flag exists); see
  // packages/cli/src/commands/audit.ts and main.ts buildRegistry().
  // `assumptions` graduated to a thin alias in Plan 15-01-01 T2; see
  // packages/cli/src/commands/assumptions.ts and main.ts buildRegistry().
  // `research` graduated from stub to real command in Plan 03-03 T3; see
  // packages/cli/src/commands/research.ts and main.ts buildRegistry().
  // `discuss` graduated to a thin shim in Plan 06-05 T4; see
  // packages/cli/src/commands/discuss.ts and main.ts buildRegistry().
  // `phase` graduated to a thin alias in Plan 15-01-01 T3; see
  // packages/cli/src/commands/phase.ts and main.ts buildRegistry().
  // `todo` graduated from stub to real command in Plan 15-02-01 T3; see
  // packages/cli/src/commands/todo.ts and main.ts buildRegistry().
  { name: 'skills', description: 'Search and install skills', roadmap_phase: 'Phase 9' },
  { name: 'whats-new', description: 'Show recent SWT release notes', roadmap_phase: 'Phase 9' },
  // `update` is registered as a real command in main.ts (Phase 04 / Plan 04-02 added marketplace dispatch alongside npm); the stub entry was pre-existing v1.0 carryforward and removed here to fix the duplicate-registration error that surfaced when scripts/docs-gen.ts called buildRegistry().
  { name: 'uninstall', description: 'Uninstall SWT', roadmap_phase: 'Phase 10' },
  // M6 PR-46: `worktree` + `lease` stubs removed. `swt cleanup` (M3 PR-29)
  // handles worktree retention + lock-file pruning; leases are an internal
  // concern of `packages/orchestration/src/lock-files.ts`. Stubs for both
  // verbs would shadow the real verbs that operators actually use.
];
