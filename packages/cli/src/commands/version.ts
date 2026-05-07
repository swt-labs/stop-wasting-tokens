import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

// `__SWT_VERSION__` is replaced at build time by tsup's `define` (set from
// the root package.json `version` field). In source/test runs (vitest, tsx)
// it is not defined; the typeof guard returns `'undefined'` and the
// fallback `'0.0.0-dev'` kicks in.
declare const __SWT_VERSION__: string | undefined;

export const CURRENT_VERSION = typeof __SWT_VERSION__ === 'string' ? __SWT_VERSION__ : '0.0.0-dev';

export function versionHandler(version: string = CURRENT_VERSION): CommandHandler {
  return (_parsed, io: CommandIO): ExitCode => {
    io.stdout.write(`swt ${version}\n`);
    return EXIT.SUCCESS;
  };
}
