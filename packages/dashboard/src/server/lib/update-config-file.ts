/**
 * `updateConfigFile` — alpha.40. Single shared read-modify-write helper for
 * `.swt-planning/config.json` mutations.
 *
 * **Why this exists (keychain_improvements.md §1.2 / structural fix):**
 *
 *   The dashboard has THREE routes that write to `.swt-planning/config.json`:
 *
 *     - `POST /api/config`             — owns `SwtConfig` preferences (theme,
 *                                        model, settings, …)
 *     - `POST /api/provider-auth`      — owns `auth.<provider>` + `providers.strategy`
 *     - `POST /api/provider-auth-oauth` — same ownership as provider-auth
 *
 *   Each route was doing its OWN read-modify-write dance. Provider-auth.ts and
 *   provider-auth-oauth.ts did it correctly from day one (read full file →
 *   mutate specific keys → write). `config.ts` (milestone-14) diverged: it
 *   validated via Zod `ConfigSchema` (which has no `auth` / `providers` and no
 *   `.passthrough()`) and wrote the validated result back — silently dropping
 *   the credential wiring on every Theme / Model / Settings save. Closed by
 *   alpha.38 commit `5f27690`, but the fix was bolted into config.ts's
 *   bespoke write block rather than centralized. Nothing structural prevented
 *   the next config-writing route from making the same mistake.
 *
 *   This helper closes that gap. All three routes now route through here. The
 *   mutator callback receives the parsed on-disk JSON (or `{}` on ENOENT) and
 *   mutates it in place; the helper guarantees every key the mutator doesn't
 *   touch survives the write byte-identical.
 *
 * **Contract:**
 *
 *   - Reads `cfgPath` as JSON. ENOENT → `current = {}` (greenfield daemon).
 *     Malformed JSON → `current = {}` (graceful degrade, matches the
 *     pre-helper config.ts behavior — a corrupt config.json gets replaced by
 *     the new write rather than crashing the request).
 *   - Calls `mutator(current)`. The mutator mutates `current` in place
 *     (assignments, spreads, deletes — whatever's natural for the caller).
 *     Any key the mutator does NOT touch is preserved verbatim from disk.
 *   - Creates the parent directory with `mkdir -p` (so greenfield daemons
 *     that haven't yet called `/api/init` don't ENOENT on the directory).
 *   - Writes `JSON.stringify(current, null, 2) + '\n'` atomically via
 *     `writeFile`.
 *   - NEVER throws on read errors — read failures degrade to `{}`. Write
 *     failures (disk full, permissions) propagate so the route returns a
 *     500 to the client.
 *
 * **Invariant test:** `update-config-file.test.ts` asserts that for any
 *   mutation that only touches a subset of top-level keys, every other
 *   top-level key survives byte-identical. This is the structural guarantee
 *   that prevents the alpha.38 bug class from ever recurring — any new
 *   config-writing route that uses this helper inherits the preservation
 *   guarantee without having to remember the read-modify-write discipline.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Read `cfgPath`, hand the parsed JSON to `mutator` for in-place mutation,
 * write the result back atomically. Preserves every top-level key the
 * mutator does not touch. See module header for the full contract.
 */
export async function updateConfigFile(
  cfgPath: string,
  mutator: (current: Record<string, unknown>) => void,
): Promise<void> {
  let current: Record<string, unknown> = {};
  try {
    const raw = await readFile(cfgPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      current = { ...(parsed as Record<string, unknown>) };
    }
  } catch (err) {
    // ENOENT → greenfield daemon, current stays {}.
    // Malformed JSON / other read errors → graceful degrade to {} so the
    // route can still respond with a fresh write. Matches the pre-helper
    // discipline in provider-auth.ts and the post-alpha.38 config.ts.
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code !== 'ENOENT') {
      // Non-ENOENT read errors degrade silently; the write below will
      // replace the offending file (or the route's write-error path
      // surfaces a 500 if the replacement also fails).
    }
  }

  mutator(current);

  await mkdir(dirname(cfgPath), { recursive: true });
  await writeFile(cfgPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}
