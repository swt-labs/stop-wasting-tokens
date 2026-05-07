export const PACKAGE_NAME = '@swt-labs/cli';
export const VERSION = '0.0.0';

export { main, buildRegistry } from './main.js';
export type { CommandHandler, CommandSpec, CommandIO } from './router.js';
export { CommandRegistry, dispatch } from './router.js';
export { EXIT } from './exit-codes.js';

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main } from './main.js';

// Detect direct invocation (`node dist/cli.mjs`, `swt` via bin symlink) vs
// library import. Compare canonical paths so symlinks (npm bin, pnpm store,
// macOS /tmp -> /private/tmp) and OS path encodings do not break the match.
function isDirectInvocation(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  void (async (): Promise<void> => {
    process.exit(await main());
  })();
}
