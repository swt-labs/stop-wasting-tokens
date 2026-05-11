export const PACKAGE_NAME = '@swt-labs/cli';
export const VERSION = '0.0.0';

export { main, buildRegistry } from './main.js';
export type { CommandHandler, CommandSpec, CommandIO } from './router.js';
export { CommandRegistry, dispatch } from './router.js';
export { EXIT } from './exit-codes.js';

// v2.3: surface the npm-registry helper + the bundle's CURRENT_VERSION so
// the dashboard's GET /api/update route can reuse the same code path the
// CLI's `swt update --json` does. Public-API expansion only — no behavior
// change for existing consumers.
export {
  queryLatestVersion,
  defaultCachePath,
  SHORT_CACHE_TTL_MS,
  type RegistryResult,
  type RegistryStatus,
  type QueryOptions,
} from './lib/npm-registry.js';
export { CURRENT_VERSION } from './commands/version.js';

import { realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from './main.js';

// Detect direct invocation (`node dist/cli.mjs`, `swt` via bin symlink) vs
// library import. Compare canonical paths so symlinks (npm bin, pnpm store,
// macOS /tmp -> /private/tmp) and OS path encodings do not break the match.
//
// IMPORTANT: when this module is imported by a *different* tsup bundle —
// e.g. the dashboard-server.mjs bundle pulls in `@swt-labs/cli` for the
// v2.3 /api/update route — tsup inlines this code into the importing
// bundle. In that scenario both `argv[1]` and `import.meta.url` resolve
// to the importing bundle's path, so the realpath equality check would
// falsely return true and trigger a recursive `main()` invocation inside
// the daemon (causing EADDRINUSE on the dashboard CLI's default port).
// Guard against that by additionally requiring the binary name to be the
// CLI bundle (`cli.mjs` in production, `index.ts` in dev/tsx mode).
function isDirectInvocation(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const argvReal = realpathSync(argv1);
    if (argvReal !== realpathSync(fileURLToPath(import.meta.url))) return false;
    const name = basename(argvReal);
    return name === 'cli.mjs' || name === 'index.ts' || name === 'cli.js';
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  void (async (): Promise<void> => {
    process.exit(await main());
  })();
}
