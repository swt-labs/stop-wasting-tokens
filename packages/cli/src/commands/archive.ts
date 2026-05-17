/**
 * `swt archive` — Plan 15-01-01 T3 alias for `swt cook --archive`.
 *
 * Promotes the stub verb (previously `EXIT.NOT_IMPLEMENTED` via STUB_SPECS)
 * to a thin shim that delegates to `cookHandler` via the shared
 * `aliasToCook` helper. The archive flow gates on the pre-archive audit
 * matrix (cook.ts:904) so this alias also drives the audit when
 * `--skip-audit` is absent.
 */

import { aliasToCook } from '../lib/alias-to-cook.js';
import type { CommandHandler } from '../router.js';

export const archiveHandler: CommandHandler = (parsed, io) => aliasToCook(parsed, io, 'archive');
