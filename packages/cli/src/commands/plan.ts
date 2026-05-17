/**
 * `swt plan` — Plan 15-01-01 T2 alias for `swt cook --plan`.
 *
 * Promotes the stub verb (previously `EXIT.NOT_IMPLEMENTED` via STUB_SPECS)
 * to a thin shim that delegates to `cookHandler` via the shared
 * `aliasToCookPlan` helper. The `--plan` cook flag is string-valued (it
 * carries an optional NN phase target), so we use `aliasToCookPlan` —
 * which lifts the first positional into the flag value — rather than the
 * generic `aliasToCook`.
 *
 * Matches the established discuss/debug shim shape (Plan 06-05 T4):
 * in-process delegation, byte-identical stdout/stderr/exit-code with
 * `swt cook --plan ...` by construction.
 */

import { aliasToCookPlan } from '../lib/alias-to-cook.js';
import type { CommandHandler } from '../router.js';

export const planHandler: CommandHandler = (parsed, io) => aliasToCookPlan(parsed, io);
