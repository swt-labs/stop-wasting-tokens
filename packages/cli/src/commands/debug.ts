/**
 * `swt debug` — Plan 06-05 T4 thin shim.
 *
 * Per Phase 3 PARITY-REPORT.md:154-158 + research §8.1: graduates the
 * existing `SWT_DEBUG_ONLY_ROLE=debugger` test seam to a production-safe
 * verb. The seam already pins routing to `qa-remediation` priority-3.5
 * (cook.ts ROLE_TO_ROUTING table). We export `SWT_ALLOW_DEBUG_ROLE=1`
 * so production users can opt in without setting `NODE_ENV=test`.
 *
 * Argv positionals are forwarded as the cook free-text body (matches the
 * `discuss` shim shape). The user can still combine with explicit cook
 * mode flags (e.g. `swt debug --verify`) — those win over the env pin
 * in the cook routing FSM.
 */

import { cookHandler } from './cook.js';
import type { ParsedArgv } from '../argv.js';
import type { CommandHandler, CommandIO } from '../router.js';
import type { ExitCode } from '../exit-codes.js';

export const debugHandler: CommandHandler = (
  parsed: ParsedArgv,
  io: CommandIO,
): Promise<ExitCode> | ExitCode => {
  // Pin routing to qa-remediation via the existing role table. Set
  // SWT_ALLOW_DEBUG_ROLE=1 so the env-var seam in cook.ts:1428 accepts
  // the pin outside NODE_ENV=test (production-safe path).
  process.env['SWT_DEBUG_ONLY_ROLE'] = 'debugger';
  process.env['SWT_ALLOW_DEBUG_ROLE'] = '1';

  const shimmed: ParsedArgv = {
    verb: 'cook',
    positionals: parsed.positionals,
    flags: parsed.flags,
  };
  return cookHandler(shimmed, io);
};
