import type { SpawnerEnvironment } from '@swt-labs/core';
import { PiSpawnerEnvironment } from '@swt-labs/orchestration';

import { parseSwtArgv } from './argv.js';
import { configHandler } from './commands/config.js';
import { registerDashboard } from './commands/dashboard.js';
import { detectPhaseHandler } from './commands/detect-phase.js';
import { doctorHandler } from './commands/doctor.js';
import { initHandler } from './commands/init.js';
import { rpcHandler } from './commands/rpc.js';
import { statusHandler } from './commands/status.js';
import { stubCommand, STUB_SPECS } from './commands/stubs.js';
import { updateHandler } from './commands/update.js';
import { CURRENT_VERSION, versionHandler } from './commands/version.js';
import { vibeHandler } from './commands/vibe.js';
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
  registry.register({
    name: 'vibe',
    usage: '[N] [--effort=level] [--yolo] [--skip-qa] [--plan=NN]',
    description: 'Detect project state and route into the right SDLC mode',
    handler: vibeHandler,
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
  registerDashboard(registry);

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

  // v2.0: bare `swt` (no verb, no flags) opens the dashboard daemon by
  // default — the natural-language UX is now the primary surface, terminal
  // is for power users. Escape hatch for CI / scripts that depend on the
  // legacy "print help on empty argv" behavior: `SWT_NO_DASHBOARD=1`.
  // `--help` / `--version` flags continue to short-circuit before the
  // dashboard launch.
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
    if (process.env['SWT_NO_DASHBOARD'] === '1') {
      io.stdout.write(renderHelp(registry));
      return EXIT.SUCCESS;
    }
    // Dispatch to `dashboard` with the same parsed shape but the verb
    // filled in. The dashboard handler defaults to opening the browser.
    const dashboardParsed = { ...parsed, verb: 'dashboard' };
    return dispatch(registry, dashboardParsed, io);
  }

  return dispatch(registry, parsed, io);
}
