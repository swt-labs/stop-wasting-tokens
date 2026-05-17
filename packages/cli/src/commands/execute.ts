/**
 * `swt execute` — Plan 15-01-01 T2 alias for `swt cook --execute`.
 *
 * Promotes the stub verb (previously `EXIT.NOT_IMPLEMENTED` via STUB_SPECS)
 * to a thin shim that delegates to `cookHandler` via the shared
 * `aliasToCook` helper. Mirrors discussHandler / debugHandler shape from
 * Plan 06-05 T4.
 */

import { aliasToCook } from '../lib/alias-to-cook.js';
import type { CommandHandler } from '../router.js';

export const executeHandler: CommandHandler = (parsed, io) => aliasToCook(parsed, io, 'execute');
