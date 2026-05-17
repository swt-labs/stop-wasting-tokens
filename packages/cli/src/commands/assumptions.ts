/**
 * `swt assumptions` — Plan 15-01-01 T2 alias for `swt cook --assumptions`.
 *
 * Promotes the stub verb (previously `EXIT.NOT_IMPLEMENTED` via STUB_SPECS)
 * to a thin shim that delegates to `cookHandler` via the shared
 * `aliasToCook` helper.
 */

import { aliasToCook } from '../lib/alias-to-cook.js';
import type { CommandHandler } from '../router.js';

export const assumptionsHandler: CommandHandler = (parsed, io) =>
  aliasToCook(parsed, io, 'assumptions');
