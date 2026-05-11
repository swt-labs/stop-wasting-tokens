import { spawnSync as nodeSpawnSync } from 'node:child_process';

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

// Published name on npm — used for both registry queries AND the upgrade
// commands surfaced to the user. The internal workspace package
// (`@swt-labs/cli`) is never published, so querying it always 404s.
const PACKAGE_NAME = 'stop-wasting-tokens';

/**
 * Package managers we'll attempt in order when auto-applying an upgrade.
 * `npm` is universally available with Node.js itself, so it's first.
 * Each entry is `[binary, args-template]` where the args template ends
 * with the package spec we'll resolve to `${PACKAGE_NAME}@latest`.
 */
const PACKAGE_MANAGERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['npm', ['install', '-g']],
  ['pnpm', ['add', '-g']],
  ['bun', ['add', '-g']],
];

const UPGRADE_COMMANDS = [
  `npm install -g ${PACKAGE_NAME}@latest`,
  `pnpm add -g ${PACKAGE_NAME}@latest`,
  `bun add -g ${PACKAGE_NAME}@latest`,
];

// Spawn signature compatible with node:child_process.spawnSync — pulled out
// so tests can inject a fake. Returns enough of the SpawnSyncReturns shape
// to drive the apply path.
export interface SpawnLike {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: NodeJS.ErrnoException;
}
export type SpawnFn = (
  cmd: string,
  args: readonly string[],
  options: { stdio: 'inherit' },
) => SpawnLike;

const defaultSpawnSync: SpawnFn = (cmd, args, options) => nodeSpawnSync(cmd, [...args], options);

export interface UpdateHandlerOptions {
  readonly fetchImpl?: typeof fetch;
  readonly cachePath?: string;
  readonly marketplaceCachePath?: string;
  readonly currentVersion?: string;
  readonly now?: () => number;
  /** Override config.marketplace.endpoint resolution (test seam). */
  readonly marketplaceEndpoint?: string | null;
  /**
   * Inject a spawn function for testing the auto-apply path. Defaults to
   * `node:child_process.spawnSync`. Only used when an upgrade is actually
   * applied (i.e. version is outdated AND --check / --json are NOT set).
   */
  readonly spawnSync?: SpawnFn;
}

/**
 * Auto-apply an upgrade by spawning the user's package manager.
 * Tries npm → pnpm → bun in order; the first one found and exiting 0 wins.
 * Returns a structured result for the caller to render.
 */
function applyUpdate(
  io: CommandIO,
  spawnFn: SpawnFn,
): { ok: true; manager: string } | { ok: false; reason: string } {
  const triedMissing: string[] = [];
  for (const [bin, baseArgs] of PACKAGE_MANAGERS) {
    const args: readonly string[] = [...baseArgs, `${PACKAGE_NAME}@latest`];
    io.stdout.write(`\n◆ Running: ${bin} ${args.join(' ')}\n`);
    const result = spawnFn(bin, args, { stdio: 'inherit' });
    if (result.error) {
      const code = result.error.code ?? '';
      if (code === 'ENOENT') {
        triedMissing.push(bin);
        io.stdout.write(`  ${bin} not found — trying next package manager...\n`);
        continue;
      }
      return { ok: false, reason: `${bin}: ${result.error.message}` };
    }
    if (result.status === 0) {
      return { ok: true, manager: bin };
    }
    return {
      ok: false,
      reason: `${bin} exited with code ${result.status ?? -1}${
        result.signal !== null ? ` (signal ${result.signal})` : ''
      }`,
    };
  }
  return {
    ok: false,
    reason: `no package manager found on PATH (tried: ${triedMissing.join(', ')})`,
  };
}

export function updateHandler(opts: UpdateHandlerOptions = {}): CommandHandler {
  return async (parsed, io: CommandIO): Promise<ExitCode> => {
    const json = parsed.flags.json === true;
    const strict = parsed.flags.strict === true;
    const checkOnly = parsed.flags.check === true;
    // v2.3.5: explicit user invocations of `swt update` default to a fresh
    // network query — the cache from v2.3.0–2.3.4 was useful for the
    // dashboard's background polling but caused real-world confusion when
    // a user ran `swt update` minutes after a release and got told
    // they were up-to-date based on a cache written before the release
    // landed. Pass `--cache` to opt back into the disk cache (useful on
    // flaky/offline networks). `--no-cache` is preserved as a no-op alias
    // for backward compat with scripts that already pass it.
    const useCache = parsed.flags.cache === true;
    const explicitNoCache = parsed.flags['no-cache'] === true;
    const noCache = explicitNoCache || !useCache;
    const noMarketplace = parsed.flags['no-marketplace'] === true;
    const registryFlag = parsed.flags.registry;
    const registry = typeof registryFlag === 'string' ? registryFlag : undefined;
    const spawnFn = opts.spawnSync ?? defaultSpawnSync;
    // JSON mode is meant for scripts/CI — never auto-apply, always behave
    // like --check so the script can decide what to do with the result.
    const shouldApply = !json && !checkOnly;

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
          io.stdout.write(`↑ Update available: v${result.current} → v${result.latest}\n`);
          if (shouldApply) {
            const apply = applyUpdate(io, spawnFn);
            if (apply.ok) {
              io.stdout.write(
                `\n✓ Upgraded to v${result.latest} via ${apply.manager}.\n` +
                  `  Restart any running 'swt' processes to pick up the new bin.\n`,
              );
            } else {
              io.stderr.write(`\n✗ Upgrade failed: ${apply.reason}\n\n`);
              io.stderr.write(`Run one of these manually:\n`);
              for (const cmd of UPGRADE_COMMANDS) {
                io.stderr.write(`  ${cmd}\n`);
              }
              return EXIT.USAGE_ERROR;
            }
          } else {
            io.stdout.write(`\nUpgrade with one of:\n`);
            for (const cmd of UPGRADE_COMMANDS) {
              io.stdout.write(`  ${cmd}\n`);
            }
            io.stdout.write(`\n(Or run \`swt update\` without --check to apply automatically.)\n`);
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
