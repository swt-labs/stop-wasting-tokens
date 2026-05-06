import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

const STATE_PATH_RELATIVE = '.swt-planning/STATE.md';

export const statusHandler: CommandHandler = async (_parsed, io: CommandIO) => {
  const path = join(io.cwd, STATE_PATH_RELATIVE);
  try {
    const raw = await readFile(path, 'utf8');
    io.stdout.write(`${raw.trim()}\n`);
    return EXIT.SUCCESS;
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      io.stderr.write(
        `No SWT project here. Run \`swt init\` to bootstrap (.swt-planning/STATE.md is missing).\n`,
      );
      return EXIT.USAGE_ERROR;
    }
    throw err;
  }
};
