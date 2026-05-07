import { detectPhase, toKeyValueLines } from '@swt-labs/methodology';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

export const detectPhaseHandler: CommandHandler = async (parsed, io: CommandIO) => {
  const bashFormat =
    parsed.positionals.includes('--bash-format') || parsed.flags['bash-format'] === true;
  const result = await detectPhase({ cwd: io.cwd });
  if (bashFormat) {
    io.stdout.write(toKeyValueLines(result));
  } else {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  return EXIT.SUCCESS satisfies ExitCode;
};
