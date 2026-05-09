import { parseSwtArgv } from './argv.js';
import { configHandler } from './commands/config.js';
import { registerDashboard } from './commands/dashboard.js';
import { detectPhaseHandler } from './commands/detect-phase.js';
import { doctorHandler } from './commands/doctor.js';
import { initHandler } from './commands/init.js';
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
  };
  const registry = deps.registry ?? buildRegistry(deps.version);

  let parsed;
  try {
    parsed = parseSwtArgv(argv);
  } catch (err) {
    io.stderr.write(`swt: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.USAGE_ERROR;
  }

  if (parsed.flags.help === true || parsed.verb === 'help' || parsed.verb === undefined) {
    if (parsed.verb === undefined && parsed.flags.help !== true && parsed.flags.version !== true) {
      io.stdout.write(renderHelp(registry));
      return EXIT.SUCCESS;
    }
  }
  if (parsed.flags.version === true) {
    io.stdout.write(`swt ${deps.version ?? CURRENT_VERSION}\n`);
    return EXIT.SUCCESS;
  }
  if (parsed.flags.help === true && parsed.verb === undefined) {
    io.stdout.write(renderHelp(registry));
    return EXIT.SUCCESS;
  }

  return dispatch(registry, parsed, io);
}
