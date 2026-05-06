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
        `  See .vbw-planning/ROADMAP.md for the full plan.\n`,
    );
    return EXIT.NOT_IMPLEMENTED;
  };
}

export const STUB_SPECS: readonly StubSpec[] = [
  { name: 'init', description: 'Initialise an SWT project', roadmap_phase: 'Phase 7' },
  { name: 'vibe', description: 'Drive the methodology lifecycle', roadmap_phase: 'Phase 7' },
  { name: 'plan', description: 'Plan a phase (Scout + Lead)', roadmap_phase: 'Phase 7' },
  { name: 'execute', description: 'Execute a planned phase', roadmap_phase: 'Phase 7' },
  { name: 'qa', description: 'Run goal-backward QA', roadmap_phase: 'Phase 8' },
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
  { name: 'update', description: 'Update SWT to the latest version', roadmap_phase: 'Phase 10' },
  { name: 'uninstall', description: 'Uninstall SWT', roadmap_phase: 'Phase 10' },
  { name: 'worktree', description: 'Manage milestone worktrees', roadmap_phase: 'Phase 7' },
  { name: 'lease', description: 'Acquire / release file locks', roadmap_phase: 'Phase 7' },
];
