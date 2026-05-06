export const PACKAGE_NAME = '@swt-labs/cli';
export const VERSION = '0.0.0';

export { main, buildRegistry } from './main.js';
export type { CommandHandler, CommandSpec, CommandIO } from './router.js';
export { CommandRegistry, dispatch } from './router.js';
export { EXIT } from './exit-codes.js';

import { main } from './main.js';

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  void (async (): Promise<void> => {
    process.exit(await main());
  })();
}
