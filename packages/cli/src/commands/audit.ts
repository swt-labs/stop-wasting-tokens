/**
 * `swt audit` — Plan 15-01-01 T3 alias for `swt cook --archive`.
 *
 * Promotes the stub verb (previously `EXIT.NOT_IMPLEMENTED` via STUB_SPECS)
 * to a thin shim that delegates to `cookHandler` via the shared
 * `aliasToCook` helper.
 *
 * **DEVN-02 partial:** cook today has NO standalone `--audit` flag. The
 * pre-archive audit matrix runs as part of the `--archive` flow
 * (cook.ts:904 "All phases complete. Run audit and archive?"). This alias
 * routes to `--archive` so the audit gate runs — but it also kicks off
 * the archive flow. A future `--audit-only` cook flag would let `audit`
 * be truly standalone; see `01-01-SUMMARY.md` for the carry-forward note.
 *
 * VBW's `/vbw:audit` runs the audit matrix without archiving. Until cook
 * grows that capability, `swt audit` is effectively `swt cook --archive`
 * — the user gets the audit gate, but archive runs on success.
 */

import { aliasToCook } from '../lib/alias-to-cook.js';
import type { CommandHandler } from '../router.js';

export const auditHandler: CommandHandler = (parsed, io) => aliasToCook(parsed, io, 'archive');
