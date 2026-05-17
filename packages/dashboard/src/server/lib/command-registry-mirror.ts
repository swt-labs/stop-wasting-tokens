import type { CommandSpec } from '@swt-labs/shared';

import { ALLOWED_NON_INTERACTIVE_VERBS, INTERACTIVE_VERBS } from './allowed-verbs.js';

/**
 * Hand-maintained mirror of the CLI's command registry. The dashboard
 * package ships as a standalone bundle (`dist/dashboard-server.mjs`
 * separate from `cli.mjs` per `tsup.config.ts`), so it mirrors small
 * slices of CLI surface rather than depending on
 * `@swt-labs/cli/main.buildRegistry()` at runtime.
 *
 * **Source of truth for entries: `packages/cli/src/main.ts:buildRegistry`
 * + `packages/cli/src/commands/stubs.ts:STUB_SPECS`.** When a new verb
 * lands there, sync this list. The vitest case
 * `commands-route.test.ts > mirror covers all known-verb sets` catches
 * silent drift on the boolean flags by asserting that every entry in
 * `ALLOWED_NON_INTERACTIVE_VERBS` and `INTERACTIVE_VERBS` is present here
 * with the matching `dashboard_safe` value.
 */
type Entry = Omit<CommandSpec, 'dashboard_safe'>;

const CORE_ENTRIES: ReadonlyArray<Entry> = [
  { name: 'help', description: 'Show this help text', usage: null, category: 'core' },
  { name: 'version', description: 'Print the swt version', usage: null, category: 'core' },
  {
    name: 'config',
    description: 'Read or update SWT configuration',
    usage: '[show|get <key>|set <key> <value>]',
    category: 'core',
  },
  {
    name: 'status',
    description: 'Show current phase and milestone status',
    usage: null,
    category: 'core',
  },
  {
    name: 'doctor',
    description: 'Check that SWT prerequisites are installed',
    usage: null,
    category: 'core',
  },
  {
    name: 'detect-phase',
    description: 'Print the computed phase-detection state (JSON by default)',
    usage: '[--bash-format]',
    category: 'core',
  },
  {
    name: 'init',
    description: 'Scaffold .swt-planning/ (PROJECT.md, STATE.md, phases/) for a fresh project',
    usage: '<name> [--description "..."]',
    category: 'core',
  },
  {
    name: 'vibe',
    description: 'Detect project state and route into the right SDLC mode',
    usage: '[N] [--effort=level] [--yolo] [--skip-qa] [--plan=NN]',
    category: 'interactive',
  },
  {
    name: 'update',
    description: 'Check the npm registry for a newer published version',
    usage: '[--json] [--strict] [--registry=<url>] [--no-cache]',
    category: 'core',
  },
  {
    name: 'watch',
    description: 'Open an Ink TUI dashboard scoped to the active milestone',
    usage: null,
    category: 'interactive',
  },
  {
    name: 'dashboard',
    description: 'Open the localhost web dashboard for the active milestone',
    usage: null,
    category: 'interactive',
  },
  // Plan 15-01-01 T4 — 7 newly-graduated aliases (plan / execute /
  // discuss / assumptions / archive / phase / audit). Each is a thin
  // shim around `swt cook --<mode>` (see packages/cli/src/commands/
  // {plan,execute,discuss,assumptions,archive,phase,audit}.ts). The
  // `dashboard_safe` flag is derived by `withDashboardSafe` from
  // `ALLOWED_NON_INTERACTIVE_VERBS` membership in allowed-verbs.ts:
  // plan/execute/audit are added to that set (non-interactive — cook
  // routes them through the methodology pipeline which prints + exits);
  // discuss/assumptions/archive/phase stay out (interactive — they hit
  // askUser checkpoints in their respective cook modes).
  {
    name: 'plan',
    description: 'Plan a phase (alias for `swt cook --plan`)',
    usage: '[N] [--effort LEVEL]',
    category: 'core',
  },
  {
    name: 'execute',
    description: 'Execute a planned phase (alias for `swt cook --execute`)',
    usage: '[N] [--effort LEVEL]',
    category: 'core',
  },
  {
    name: 'discuss',
    description: 'Discuss the next move via cook priority-8 routing (interactive)',
    usage: null,
    category: 'core',
  },
  {
    name: 'assumptions',
    description: 'Capture phase assumptions (alias for `swt cook --assumptions`)',
    usage: null,
    category: 'core',
  },
  {
    name: 'archive',
    description: 'Archive a completed milestone (alias for `swt cook --archive`)',
    usage: null,
    category: 'core',
  },
  {
    name: 'phase',
    description: 'Add / insert / remove phases (alias for cook --add/--insert/--remove)',
    usage: '[--add "name" | --insert N "name" | --remove N]',
    category: 'core',
  },
  {
    name: 'audit',
    description: 'Run the pre-archive audit matrix (alias for `swt cook --archive`)',
    usage: null,
    category: 'core',
  },
  // Plan 15-02-01 T4 — `todo` graduates from STUB_ENTRIES (below) to a
  // real non-interactive verb. The handler is line-by-line file I/O
  // (no Pi spawn, no askUser), so `dashboard_safe: true` is correct;
  // membership is conferred by ALLOWED_NON_INTERACTIVE_VERBS in
  // allowed-verbs.ts via `withDashboardSafe`.
  {
    name: 'todo',
    description: 'Add a backlog item to STATE.md ## Todos',
    usage: '"<description>" [--detail] [--phase] [--files] [--priority] [--assignee]',
    category: 'core',
  },
];

const STUB_ENTRIES: ReadonlyArray<Entry> = [
  // Plan 15-01-01 T4 — plan / execute / discuss / assumptions / archive /
  // phase / audit moved to CORE_ENTRIES above (now thin aliases for
  // `swt cook --<mode>`).
  { name: 'qa', description: 'Run goal-backward QA', usage: null, category: 'stub' },
  { name: 'map', description: 'Map an existing codebase', usage: null, category: 'stub' },
  { name: 'debug', description: 'Hypothesis-driven debugging', usage: null, category: 'stub' },
  {
    name: 'fix',
    description: 'Quick-fix path for small UAT issues',
    usage: null,
    category: 'stub',
  },
  {
    name: 'release',
    description: 'Cut a release via Changesets',
    usage: null,
    category: 'stub',
  },
  { name: 'resume', description: 'Resume a paused session', usage: null, category: 'stub' },
  { name: 'pause', description: 'Pause and stash session state', usage: null, category: 'stub' },
  {
    name: 'research',
    description: 'Run a Scout-only research pass',
    usage: null,
    category: 'stub',
  },
  {
    // Plan 04-02 T5 (REQ-17) — verify is the quick-action verify pass; it
    // runs the full QA + freshness pipeline, so the route extends its
    // timeout to 90s (see allowed-verbs.ts QUICK_VERB_TIMEOUT_MS_OVERRIDE).
    name: 'verify',
    description: 'Run the QA + freshness verification pass',
    usage: null,
    category: 'stub',
  },
  // Plan 15-02-01 T4 — `todo` moved to CORE_ENTRIES above (real verb).
  { name: 'skills', description: 'Search and install skills', usage: null, category: 'stub' },
  {
    name: 'whats-new',
    description: 'Show recent SWT release notes',
    usage: null,
    category: 'stub',
  },
  { name: 'uninstall', description: 'Uninstall SWT', usage: null, category: 'stub' },
  { name: 'worktree', description: 'Manage milestone worktrees', usage: null, category: 'stub' },
  { name: 'lease', description: 'Acquire / release file locks', usage: null, category: 'stub' },
];

function withDashboardSafe(entry: Entry): CommandSpec {
  return {
    ...entry,
    // The allowed-verbs set is the canonical "dashboard_safe = true"
    // gate. Stubs and interactive verbs are never safe.
    dashboard_safe: ALLOWED_NON_INTERACTIVE_VERBS.has(entry.name),
  };
}

export const COMMAND_REGISTRY_ENTRIES: ReadonlyArray<CommandSpec> = [
  ...CORE_ENTRIES,
  ...STUB_ENTRIES,
]
  .map(withDashboardSafe)
  // Stable ordering matches the CLI's `swt help` (alphabetical).
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name));

// Re-export for the drift-detection vitest case.
export { ALLOWED_NON_INTERACTIVE_VERBS, INTERACTIVE_VERBS };
