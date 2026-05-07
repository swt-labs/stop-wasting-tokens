import { loadSwtConfig } from '@swt-labs/methodology';

import { EXIT, type ExitCode } from '../exit-codes.js';
import {
  queryMarketplaceVersion,
  MarketplaceQueryError,
  type MarketplaceVersion,
} from '../lib/marketplace-registry.js';
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
  readonly marketplaceCachePath?: string;
  readonly currentVersion?: string;
  readonly now?: () => number;
  /** Override config.marketplace.endpoint resolution (test seam). */
  readonly marketplaceEndpoint?: string | null;
}

export function updateHandler(opts: UpdateHandlerOptions = {}): CommandHandler {
  return async (parsed, io: CommandIO): Promise<ExitCode> => {
    const json = parsed.flags.json === true;
    const strict = parsed.flags.strict === true;
    const noCache = parsed.flags['no-cache'] === true;
    const noMarketplace = parsed.flags['no-marketplace'] === true;
    const registryFlag = parsed.flags.registry;
    const registry = typeof registryFlag === 'string' ? registryFlag : undefined;

    const queryOpts: QueryOptions = {
      ...(registry !== undefined ? { registry } : {}),
      noCache,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.cachePath !== undefined ? { cachePath: opts.cachePath } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    };

    const current = opts.currentVersion ?? CURRENT_VERSION;
    const result = await queryLatestVersion(PACKAGE_NAME, current, queryOpts);

    let marketplaceEndpoint: string | undefined;
    if (opts.marketplaceEndpoint === null) {
      marketplaceEndpoint = undefined;
    } else if (typeof opts.marketplaceEndpoint === 'string') {
      marketplaceEndpoint = opts.marketplaceEndpoint;
    } else {
      try {
        const config = await loadSwtConfig(`${io.cwd}/.swt-planning`);
        marketplaceEndpoint = config.marketplace?.endpoint;
      } catch {
        marketplaceEndpoint = undefined;
      }
    }

    let marketplaceResult: MarketplaceVersion | undefined;
    let marketplaceError: string | undefined;
    if (!noMarketplace && marketplaceEndpoint !== undefined) {
      try {
        marketplaceResult = await queryMarketplaceVersion({
          endpoint: marketplaceEndpoint,
          packageName: PACKAGE_NAME,
          ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
          noCache,
          ...(opts.marketplaceCachePath !== undefined
            ? { cachePath: opts.marketplaceCachePath }
            : {}),
          ...(opts.now !== undefined ? { now: opts.now } : {}),
        });
      } catch (err) {
        marketplaceError =
          err instanceof MarketplaceQueryError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
      }
    }

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
      if (marketplaceResult !== undefined) {
        payload.marketplace = {
          version: marketplaceResult.version,
          fromCache: marketplaceResult.fromCache,
        };
      } else if (marketplaceError !== undefined) {
        payload.marketplace = { error: marketplaceError };
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
          io.stderr.write(`⚠ Could not check for updates: ${result.error ?? 'unknown error'}\n`);
          break;
      }
      if (marketplaceResult !== undefined) {
        if (marketplaceResult.version === result.latest) {
          io.stdout.write(`  (also published on marketplace at v${marketplaceResult.version})\n`);
        } else {
          io.stdout.write(
            `⚠ Marketplace version (v${marketplaceResult.version}) differs from npm (v${result.latest})\n`,
          );
        }
      } else if (marketplaceError !== undefined) {
        io.stderr.write(`  (marketplace lookup skipped: ${marketplaceError})\n`);
      }
    }

    if (result.status === 'unreachable' && strict) {
      return EXIT.USAGE_ERROR;
    }
    return EXIT.SUCCESS;
  };
}
