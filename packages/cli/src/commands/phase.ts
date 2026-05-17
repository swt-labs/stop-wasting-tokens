/**
 * `swt phase` — Plan 15-01-01 T3 alias for cook's phase sub-modes.
 *
 * Promotes the stub verb (previously `EXIT.NOT_IMPLEMENTED` via STUB_SPECS)
 * to a thin shim that delegates to `cookHandler` via the shared
 * `phaseAlias` helper.
 *
 * `swt phase --add "X"` / `--insert N "X"` / `--remove N` all map to
 * the matching cook flag without further translation — the global argv
 * parser (packages/cli/src/argv.ts:78-80) already accepts these flags
 * directly, and `detectModeFromFlags` (cook.ts:686-688) already routes
 * each to the matching mode (`add-phase` / `insert-phase` / `remove-phase`).
 * `phaseAlias` simply rewrites the verb to `'cook'` and forwards.
 *
 * Bare `swt phase` (no sub-flag) falls through to cook's state-driven
 * 11-priority routing — matches the documented VBW `/vbw:phase` semantics
 * (the verb reports whatever phase work is pending).
 */

import { phaseAlias } from '../lib/alias-to-cook.js';
import type { CommandHandler } from '../router.js';

export const phaseHandler: CommandHandler = (parsed, io) => phaseAlias(parsed, io);
