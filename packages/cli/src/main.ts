import type { SpawnerEnvironment } from '@swt-labs/core';
import { PiSpawnerEnvironment } from '@swt-labs/orchestration';
import { applyEnvToProcess } from '@swt-labs/runtime';

import { parseSwtArgv } from './argv.js';
import { archiveHandler } from './commands/archive.js';
import { assumptionsHandler } from './commands/assumptions.js';
import { auditHandler } from './commands/audit.js';
import { benchHandler } from './commands/bench.js';
import { cleanupHandler } from './commands/cleanup.js';
import { configHandler } from './commands/config.js';
import { cookHandler } from './commands/cook.js';
import { registerDashboard } from './commands/dashboard.js';
import { debugHandler } from './commands/debug.js';
import { detectPhaseHandler } from './commands/detect-phase.js';
import { discussHandler } from './commands/discuss.js';
import { doctorHandler } from './commands/doctor.js';
import { executeHandler } from './commands/execute.js';
import { initHandler } from './commands/init.js';
import { listTodosHandler } from './commands/list-todos.js';
import { mapHandler } from './commands/map.js';
import { migrateHandler } from './commands/migrate.js';
import { phaseHandler } from './commands/phase.js';
import { planHandler } from './commands/plan.js';
import { qaHandler } from './commands/qa.js';
import { researchHandler } from './commands/research.js';
import { rpcHandler } from './commands/rpc.js';
import { statusHandler } from './commands/status.js';
import { fixDeprecatedHandler, stubCommand, STUB_SPECS } from './commands/stubs.js';
import { todoHandler } from './commands/todo.js';
import { updateHandler } from './commands/update.js';
import { verifyHandler } from './commands/verify.js';
import { CURRENT_VERSION, versionHandler } from './commands/version.js';
import { defaultWatchHandler } from './commands/watch.js';
import { EXIT, type ExitCode } from './exit-codes.js';
import { helpHandler, renderHelp } from './help.js';
import { CommandRegistry, dispatch, type CommandIO } from './router.js';

export interface MainDeps {
  readonly cwd?: string;
  readonly stdout?: NodeJS.WritableStream;
  readonly stderr?: NodeJS.WritableStream;
  readonly version?: string;
  readonly registry?: CommandRegistry;
  /**
   * Optional override for the SpawnerEnvironment threaded into CommandIO.
   *
   * Default chain across the M1 PR sequence:
   *   PR-01b: `Pr01bStubSpawnerEnvironment` (probe → unavailable, getSpawner → throws)
   *   PR-02:  `MockSpawnerEnvironment` from `@swt-labs/runtime`
   *            (probe → available with name `pi-runtime-mock`, getSpawner → throws with
   *             a pointer to PR-03)
   *   PR-03:  `PiSpawnerEnvironment` from `@swt-labs/orchestration`
   *            (probe → real Pi-installed check, getSpawner → real dispatcher-backed)
   */
  readonly spawnerEnv?: SpawnerEnvironment;
}

export function buildRegistry(version: string = CURRENT_VERSION): CommandRegistry {
  const registry = new CommandRegistry();

  registry.register({
    name: 'help',
    description: 'Show this help text',
    handler: helpHandler(registry),
  });
  registry.register({
    name: 'version',
    description: 'Print the swt version',
    handler: versionHandler(version),
  });
  registry.register({
    name: 'config',
    usage: '[show|get <key>|set <key> <value>]',
    description: 'Read or update SWT configuration',
    handler: configHandler,
  });
  registry.register({
    name: 'status',
    description: 'Show current phase and milestone status',
    handler: statusHandler,
  });
  registry.register({
    name: 'doctor',
    description: 'Check that SWT prerequisites are installed',
    handler: doctorHandler(),
  });
  registry.register({
    name: 'detect-phase',
    usage: '[--bash-format]',
    description: 'Print the computed phase-detection state (JSON by default)',
    handler: detectPhaseHandler,
  });
  registry.register({
    name: 'init',
    usage: '<name> [--description "..."]',
    description: 'Scaffold .swt-planning/ (PROJECT.md, STATE.md, phases/) for a fresh project',
    handler: initHandler,
  });
  // Plan 03-02 (Phase 3): `swt cook` — the orchestrator entry. Auto-routes
  // via state detection (detectPhase) and the 11-priority routing table
  // (TDD3 §7.3), or honours --plan/--execute/--discuss/... mode flags
  // when present (TDD3 §7.2). Replaces the v3.0.0-alpha.3 stub that
  // returned EXIT.NOT_IMPLEMENTED (REQ-25).
  registry.register({
    name: 'cook',
    usage: '[--plan|--execute|--discuss|--assumptions|--scope|--verify|--archive] [arguments]',
    description: 'Run the SWT orchestrator (auto-routes via state detection)',
    handler: cookHandler,
  });
  // Plan 03-03 T1 (Phase 3): `swt qa` — spawns a QA agent loading
  // commands/qa.md. Replaces the v3.0.0-alpha.3 stub (REQ-25).
  registry.register({
    name: 'qa',
    usage: '[phase-number]',
    description: 'Run goal-backward QA on a phase',
    handler: qaHandler,
  });
  // Plan 03-03 T2 (Phase 3): `swt verify` — INLINE UAT checkpoint loop.
  // Does NOT spawn a Pi session per architect-R3 (askUser is orchestrator-
  // only). The TypeScript handler IS the protocol implementation; the
  // 890-LOC commands/verify.md is documentation, not LLM prompt.
  // TDD3 §12.3.
  registry.register({
    name: 'verify',
    usage: '[phase-number]',
    description: 'Run the UAT checkpoint loop on a phase (inline; no Pi spawn)',
    handler: verifyHandler,
  });
  // Plan 03-03 T3 (Phase 3): `swt research` — spawns a Scout agent loading
  // commands/research.md. Replaces the v3.0.0-alpha.3 stub (REQ-25).
  registry.register({
    name: 'research',
    usage: '<topic>',
    description: 'Run a Scout-only research pass',
    handler: researchHandler,
  });
  // Plan 03-03 T4 (Phase 3): `swt map` — 4-way parallel Scout fan-out per
  // TDD3 §4 + REQ-04 (DAG-based parallel execution). Spawns 4 Scouts via
  // Promise.all([spawnAgent('scout',...) × 4]); each writes a slice of
  // .swt-planning/codebase/ directly.
  registry.register({
    name: 'map',
    description: 'Map an existing codebase (4 parallel Scouts)',
    handler: mapHandler,
  });
  registry.register({
    name: 'update',
    usage: '[--json] [--strict] [--registry=<url>] [--no-cache]',
    description: 'Check the npm registry for a newer published version',
    handler: updateHandler({ currentVersion: version }),
  });
  registry.register({
    name: 'watch',
    description: 'Open an Ink TUI dashboard scoped to the active milestone',
    handler: defaultWatchHandler,
  });
  registry.register({
    name: 'rpc',
    description: "Delegate to Pi's JSON-RPC mode (stdout reserved for protocol stream)",
    handler: rpcHandler,
  });
  registry.register({
    name: 'bench',
    usage: '[--fixture=<name>] [--provider=<name>] [--cassettes=<path>] [--output=<file>]',
    description: 'Replay the TPAC reference scenario and emit a validated TpacReport',
    handler: benchHandler,
  });
  registry.register({
    name: 'cleanup',
    usage: '[--list] | [--force --task-id <id>] | [--prune-locks]',
    description: 'List, force-remove, or prune-locks for parallel-task worktrees',
    handler: cleanupHandler,
  });
  registry.register({
    name: 'migrate',
    usage: '--to=v3 --input <v2-planning-dir> --output <v3-planning-dir>',
    description: 'Migrate a v2.x `.swt-planning/` to v3 schema (backend + thinking_level rename)',
    handler: migrateHandler,
  });
  registerDashboard(registry);

  // Plan 06-05 T4 — discuss/debug graduate from EXIT.NOT_IMPLEMENTED stubs to
  // thin shims that delegate to cookHandler. fix stays deprecated but its
  // message is meaningful (see fixDeprecatedHandler in stubs.ts).
  registry.register({
    name: 'discuss',
    description: 'Discuss the next move via cook priority-8 routing (interactive)',
    handler: discussHandler,
  });
  registry.register({
    name: 'debug',
    description: 'Drive debugger role via cook qa-remediation routing pin',
    handler: debugHandler,
  });
  registry.register({
    name: 'fix',
    description: 'Deprecated — use `swt cook` or `swt qa` for remediation',
    handler: fixDeprecatedHandler,
  });

  // Plan 15-01-01 T2 — promote 4 simple-flag aliases (plan / execute /
  // assumptions) from STUB_SPECS to thin shims around cookHandler via the
  // shared aliasToCook helper. `discuss` already shipped above (Plan 06-05
  // T4); the remaining 3 aliases (archive / phase / audit) land in T3.
  registry.register({
    name: 'plan',
    usage: '[N] [--effort LEVEL]',
    description: 'Plan a phase (alias for `swt cook --plan`)',
    handler: planHandler,
  });
  registry.register({
    name: 'execute',
    usage: '[N] [--effort LEVEL]',
    description: 'Execute a planned phase (alias for `swt cook --execute`)',
    handler: executeHandler,
  });
  registry.register({
    name: 'assumptions',
    description: 'Capture phase assumptions (alias for `swt cook --assumptions`)',
    handler: assumptionsHandler,
  });

  // Plan 15-01-01 T3 — promote 3 sub-mode / sub-flag aliases (archive /
  // phase / audit) from STUB_SPECS to thin shims around cookHandler.
  // `phase` is a no-op forwarder (cook already routes --add/--insert/--remove);
  // `audit` aliases to --archive today since cook has no standalone --audit
  // flag (DEVN-02 partial — see audit.ts docstring).
  registry.register({
    name: 'archive',
    description: 'Archive a completed milestone (alias for `swt cook --archive`)',
    handler: archiveHandler,
  });
  registry.register({
    name: 'phase',
    usage: '[--add "name" | --insert N "name" | --remove N]',
    description: 'Add / insert / remove phases (alias for cook --add/--insert/--remove)',
    handler: phaseHandler,
  });
  registry.register({
    name: 'audit',
    description: 'Run the pre-archive audit matrix (alias for `swt cook --archive`)',
    handler: auditHandler,
  });

  // Plan 15-02-01 T3 — `swt todo "<description>"` graduates from
  // STUB_SPECS to a real verb. Appends to STATE.md ## Todos with VBW
  // format `- [TODO] {description} (added YYYY-MM-DD) (ref:HASH)` and
  // optionally persists extended detail to .swt-planning/todo-details.json
  // keyed by the same 8-char sha256 hash.
  registry.register({
    name: 'todo',
    usage:
      '"<description>" [--detail STR] [--phase NN] [--files CSV] [--priority high|medium|low] [--assignee USER]',
    description:
      'Add a backlog item to STATE.md ## Todos. Supports --detail, --phase, --files, --priority, --assignee.',
    handler: todoHandler,
  });

  // Plan 03-01 T4 — `swt list-todos` is a new non-interactive read-only
  // verb. NOT in STUB_SPECS prior to this plan (the milestone-15-2 audit
  // only stubbed `todo` + future status-change verbs); registering it
  // here directly is correct. Parses STATE.md `## Todos` into structured
  // entries, applies repeatable `--filter key=value` (AND-combined),
  // renders a numbered status-iconified list, and writes a session
  // snapshot at `.swt-planning/.cache/list-todos-snapshot.json` for
  // Phase 04's bare-integer cook resolver. `--json` skips the snapshot.
  registry.register({
    name: 'list-todos',
    usage: '[--filter key=value ...] [--json]',
    description:
      'Read STATE.md ## Todos and render a numbered list (writes a session snapshot for bare-integer cook pickup).',
    handler: listTodosHandler,
  });

  for (const spec of STUB_SPECS) {
    registry.register({
      name: spec.name,
      description: spec.description,
      handler: stubCommand(spec),
    });
  }

  return registry;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: MainDeps = {},
): Promise<ExitCode> {
  // Plan 01-02: populate SWT_INSTALL_ROOT + SWT_SESSION_ID on process.env
  // BEFORE any registry build, argv parse, or child-process spawn. The
  // dashboard command (commands/dashboard.ts) spawns the dashboard-server
  // bundle via child_process.spawn — that child inherits process.env by
  // default (its explicit `env: { ...process.env, ... }` merge does NOT
  // drop these vars), so this single call wires both env vars through
  // every downstream subprocess. Idempotent; safe to call again.
  applyEnvToProcess();

  // Plan 06-04 T3 (R3 / DEVN-04): cross-process cassette bootstrap. If
  // a parent process called `installReplay(path)` and then spawned this
  // CLI as a subprocess (e.g. `runVibe()` → `swt cook`), the child
  // inherits `SWT_CASSETTE_PATH` via the default env merge. Install the
  // cassette here, BEFORE any HTTP traffic could occur. Dynamic import
  // keeps `@swt-labs/test-utils` out of the production bundle when no
  // cassette is configured (env unset = no import, no overhead).
  // Failures are swallowed by design: a missing cassette must surface
  // as a `RequestNotInCassetteError` at request time (the cassette
  // discipline of REQ-22), not as a CLI bootstrap crash.
  if (
    process.env['SWT_CASSETTE_PATH'] !== undefined &&
    process.env['SWT_CASSETTE_PATH'].length > 0
  ) {
    try {
      const { installReplayFromEnv } = await import('@swt-labs/test-utils/cassettes');
      installReplayFromEnv();
    } catch {
      // best-effort; cassette replay is a test-utility surface and its
      // absence should never block real CLI invocations.
    }
  }

  const io: CommandIO = {
    cwd: deps.cwd ?? process.cwd(),
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    spawnerEnv: deps.spawnerEnv ?? new PiSpawnerEnvironment(),
  };
  const registry = deps.registry ?? buildRegistry(deps.version);

  let parsed;
  try {
    parsed = parseSwtArgv(argv);
  } catch (err) {
    io.stderr.write(`swt: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.USAGE_ERROR;
  }

  // Bare `swt` (no verb, no flags) auto-launches the dashboard daemon.
  // The dashboard is SWT's primary surface — it absorbs the chat-style
  // UX, the UAT checkpoint loop, and live agent observability. CLI verbs
  // (`swt cook`, `swt qa`, `swt status`, ...) remain available for power
  // users and scripts but are not the default invocation. No escape hatch:
  // if you want a verb, type the verb. See TDD3 §15 + §24 for the design
  // rationale. (This restores the v3.0.0-alpha.2 default after the brief
  // alpha.3 detour that routed bare-`swt` to the orchestrator instead.)
  if (parsed.flags.version === true) {
    io.stdout.write(`swt ${deps.version ?? CURRENT_VERSION}\n`);
    return EXIT.SUCCESS;
  }
  if (parsed.flags.help === true) {
    io.stdout.write(renderHelp(registry));
    return EXIT.SUCCESS;
  }
  if (parsed.verb === 'help') {
    io.stdout.write(renderHelp(registry));
    return EXIT.SUCCESS;
  }
  if (parsed.verb === undefined) {
    const dashboardParsed = { ...parsed, verb: 'dashboard' };
    return dispatch(registry, dashboardParsed, io);
  }

  return dispatch(registry, parsed, io);
}
