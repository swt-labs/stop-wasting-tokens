/**
 * `swt discuss` — Plan 06-05 T4 thin shim.
 *
 * Per Phase 3 PARITY-REPORT.md:154-158 + research §8.1: discuss has no
 * semantically distinct behavior from `swt cook --discuss` (priority-8
 * routing in TDD3 §7.3). This shim graduates the verb from EXIT.NOT_IMPLEMENTED
 * stub to a live entry point that delegates to cookHandler with the
 * `--discuss` mode flag synthesized into parsed.flags.
 */

import type { ParsedArgv } from '../argv.js';
import type { ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

import { cookHandler } from './cook.js';

export const discussHandler: CommandHandler = (
  parsed: ParsedArgv,
  io: CommandIO,
): Promise<ExitCode> | ExitCode => {
  const shimmedFlags: ParsedArgv['flags'] = { ...parsed.flags, discuss: true };
  const shimmed: ParsedArgv = {
    verb: 'cook',
    positionals: parsed.positionals,
    flags: shimmedFlags,
  };
  return cookHandler(shimmed, io);
};
