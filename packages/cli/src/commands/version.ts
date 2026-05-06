import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

export const CURRENT_VERSION = '0.0.0';

export function versionHandler(version: string = CURRENT_VERSION): CommandHandler {
  return (_parsed, io: CommandIO): ExitCode => {
    io.stdout.write(`swt ${version}\n`);
    return EXIT.SUCCESS;
  };
}
