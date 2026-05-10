import { AlreadyInitializedError, initProject } from '@swt-labs/core';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

export const initHandler: CommandHandler = (parsed, io: CommandIO): ExitCode => {
  // Project name from the first positional after `swt init`. The dispatcher
  // strips the verb itself, so positionals[0] here is what the user typed.
  // Description can come from --description "..." or the second positional.
  const name = parsed.positionals[0];
  if (name === undefined || name.trim().length === 0) {
    io.stderr.write('Usage: swt init <name> [--description "..."]\n');
    return EXIT.USAGE_ERROR;
  }
  const flagDescription = parsed.flags.description;
  const positionalDescription = parsed.positionals[1];
  const description =
    typeof flagDescription === 'string' && flagDescription.length > 0
      ? flagDescription
      : positionalDescription;

  try {
    const result = initProject({
      cwd: io.cwd,
      name: name.trim(),
      ...(description !== undefined && description.length > 0 ? { description } : {}),
    });
    io.stdout.write(`✓ Initialized .swt-planning/ at ${result.root}\n`);
    for (const file of result.files) {
      io.stdout.write(`  • ${file}\n`);
    }
    io.stdout.write(`\nNext: run \`swt vibe\` to scope the first milestone.\n`);
    return EXIT.SUCCESS;
  } catch (err: unknown) {
    if (err instanceof AlreadyInitializedError) {
      io.stderr.write(
        `swt init: .swt-planning/ already exists at ${io.cwd}. Run \`swt vibe\` to continue, or remove the dir to re-initialize.\n`,
      );
      return EXIT.USAGE_ERROR;
    }
    const message = err instanceof Error ? err.message : String(err);
    io.stderr.write(`swt init: failed to scaffold .swt-planning/: ${message}\n`);
    return EXIT.RUNTIME_ERROR;
  }
};
