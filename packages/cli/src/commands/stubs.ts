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

export const STUB_SPECS: readonly StubSpec[] = [
  // `init` graduated from stub to real command in v1.7.0; see
  // packages/cli/src/commands/init.ts and main.ts buildRegistry().
  { name: 'plan', description: 'Plan a phase (Scout + Lead)', roadmap_phase: 'Phase 7' },
  { name: 'execute', description: 'Execute a planned phase', roadmap_phase: 'Phase 7' },
  // `qa` graduated from stub to real command in Plan 03-03 T1; see
  // packages/cli/src/commands/qa.ts and main.ts buildRegistry().
  { name: 'map', description: 'Map an existing codebase', roadmap_phase: 'Phase 7' },
  { name: 'debug', description: 'Hypothesis-driven debugging', roadmap_phase: 'Phase 8' },
  { name: 'fix', description: 'Quick-fix path for small UAT issues', roadmap_phase: 'Phase 8' },
  { name: 'archive', description: 'Archive a milestone', roadmap_phase: 'Phase 7' },
  { name: 'release', description: 'Cut a release via Changesets', roadmap_phase: 'Phase 10' },
  { name: 'resume', description: 'Resume a paused session', roadmap_phase: 'Phase 7' },
  { name: 'pause', description: 'Pause and stash session state', roadmap_phase: 'Phase 7' },
  { name: 'audit', description: 'Run the pre-archive audit matrix', roadmap_phase: 'Phase 7' },
  { name: 'assumptions', description: 'Capture phase assumptions', roadmap_phase: 'Phase 7' },
  { name: 'research', description: 'Run a Scout-only research pass', roadmap_phase: 'Phase 7' },
  { name: 'discuss', description: 'Run the discussion engine', roadmap_phase: 'Phase 7' },
  { name: 'phase', description: 'Add / insert / remove phases', roadmap_phase: 'Phase 7' },
  { name: 'todo', description: 'Manage the STATE.md todo list', roadmap_phase: 'Phase 7' },
  { name: 'skills', description: 'Search and install skills', roadmap_phase: 'Phase 9' },
  { name: 'whats-new', description: 'Show recent SWT release notes', roadmap_phase: 'Phase 9' },
  // `update` is registered as a real command in main.ts (Phase 04 / Plan 04-02 added marketplace dispatch alongside npm); the stub entry was pre-existing v1.0 carryforward and removed here to fix the duplicate-registration error that surfaced when scripts/docs-gen.ts called buildRegistry().
  { name: 'uninstall', description: 'Uninstall SWT', roadmap_phase: 'Phase 10' },
  // M6 PR-46: `worktree` + `lease` stubs removed. `swt cleanup` (M3 PR-29)
  // handles worktree retention + lock-file pruning; leases are an internal
  // concern of `packages/orchestration/src/lock-files.ts`. Stubs for both
  // verbs would shadow the real verbs that operators actually use.
];
