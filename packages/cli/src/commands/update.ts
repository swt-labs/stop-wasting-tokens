import { EXIT, type ExitCode } from '../exit-codes.js';
import { queryLatestVersion, type QueryOptions } from '../lib/npm-registry.js';
import type { CommandHandler, CommandIO } from '../router.js';

import { CURRENT_VERSION } from './version.js';

const PACKAGE_NAME = '@swt-labs/cli';

const UPGRADE_COMMANDS = [
  'npm install -g @swt-labs/cli@latest',
  'pnpm add -g @swt-labs/cli@latest',
  'bun add -g @swt-labs/cli@latest',
];

export interface UpdateHandlerOptions {
  readonly fetchImpl?: typeof fetch;
  readonly cachePath?: string;
  readonly currentVersion?: string;
  readonly now?: () => number;
}

export function updateHandler(opts: UpdateHandlerOptions = {}): CommandHandler {
  return async (parsed, io: CommandIO): Promise<ExitCode> => {
    const json = parsed.flags.json === true;
    const strict = parsed.flags.strict === true;
    const noCache = parsed.flags['no-cache'] === true;
    const registryFlag = parsed.flags.registry;
    const registry = typeof registryFlag === 'string' ? registryFlag : undefined;

    const queryOpts: QueryOptions = {
      registry,
      noCache,
      fetchImpl: opts.fetchImpl,
      cachePath: opts.cachePath,
      now: opts.now,
    };

    const current = opts.currentVersion ?? CURRENT_VERSION;
    const result = await queryLatestVersion(PACKAGE_NAME, current, queryOpts);

    if (json) {
      const payload: Record<string, unknown> = {
        status: result.status,
        current: result.current,
        latest: result.latest,
        cached: result.cached ?? false,
      };
      if (result.status === 'outdated') {
        payload.upgrade_commands = UPGRADE_COMMANDS;
      }
      if (result.error !== undefined) {
        payload.error = result.error;
      }
      io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      switch (result.status) {
        case 'up-to-date':
          io.stdout.write(`✓ swt is up-to-date (v${result.current})\n`);
          break;
        case 'outdated':
          io.stdout.write(
            `↑ Update available: v${result.current} → v${result.latest}\n\nUpgrade with one of:\n`,
          );
          for (const cmd of UPGRADE_COMMANDS) {
            io.stdout.write(`  ${cmd}\n`);
          }
          break;
        case 'unreachable':
          io.stderr.write(
            `⚠ Could not check for updates: ${result.error ?? 'unknown error'}\n`,
          );
          break;
      }
    }

    if (result.status === 'unreachable' && strict) {
      return EXIT.USAGE_ERROR;
    }
    return EXIT.SUCCESS;
  };
}
