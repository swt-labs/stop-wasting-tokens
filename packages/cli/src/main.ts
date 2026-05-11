import type {
  AgentSpawner,
  SpawnerEnvironment,
  SpawnerProbeResult,
} from '@swt-labs/core';

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
  /**
   * Optional override for the SpawnerEnvironment threaded into CommandIO. PR-01b ships a
   * fail-fast stub; PR-02 swaps the default for `MockSpawnerEnvironment` from
   * `@swt-labs/runtime`; PR-03 swaps to `PiSpawnerEnvironment` from `@swt-labs/orchestration`.
   */
  readonly spawnerEnv?: SpawnerEnvironment;
}

/**
 * PR-01b stub. Probe reports unavailable with a clear pointer to PR-02; `getSpawner` throws
 * if anything actually tries to spawn. `swt doctor` runs cleanly with this stub (it gets
 * `undefined` for the legacy `codex` field); `swt vibe` fails fast before any methodology
 * handler attempts to dispatch.
 */
class Pr01bStubSpawnerEnvironment implements SpawnerEnvironment {
  async probe(): Promise<SpawnerProbeResult> {
    return {
      available: false,
      name: 'none',
      reason: 'PR-02 not yet merged — runtime adapter (packages/runtime/) is not present yet.',
    };
  }
  async getSpawner(): Promise<AgentSpawner> {
    throw new Error(
      'SpawnerEnvironment stub: real spawner lands in M1 PR-02 (mock Pi) → PR-03 (PiSpawnerEnvironment). ' +
        '`swt vibe` is intentionally non-functional between PR-01b and PR-02.',
    );
  }
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
    spawnerEnv: deps.spawnerEnv ?? new Pr01bStubSpawnerEnvironment(),
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
