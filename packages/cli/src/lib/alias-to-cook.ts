/**
 * `aliasToCook` — shared alias-to-cook translation helper.
 *
 * Plan 15-01-01 T1. Promotes 7 historically-stub verbs (`plan`, `execute`,
 * `discuss`, `assumptions`, `archive`, `phase`, `audit`) to thin wrappers
 * around `swt cook --<mode>`. The authoritative routing logic stays in
 * `cook.ts:routeFromPhaseDetect()` + `detectModeFromFlags()`; this module
 * just sets the matching cook flag on the parsed argv and forwards to
 * `cookHandler`.
 *
 * ## Design — in-process delegation (NOT subprocess)
 *
 * The plan's task-1 description suggested `child_process.spawn` for stdio
 * inheritance + exit-code propagation. We deviate to **in-process
 * delegation** because:
 *
 *  1. The established pattern for this kind of shim — shipped in Plan
 *     06-05 T4 for `discuss` + `debug` — is in-process: mutate a copy of
 *     `parsed.flags`, forward to `cookHandler` directly. Introducing a
 *     parallel subprocess pattern here would split the codebase.
 *  2. In-process delegation is **byte-identical by construction**: no
 *     subprocess startup ceremony, no PATH resolution variance, no
 *     buffering differences. The plan's regression-test assertion
 *     (byte-identical stdout/stderr/exit-code) is satisfied trivially.
 *  3. ~300-500ms cheaper per invocation (no Node startup).
 *
 * Captured as DEVN-02 in `01-01-SUMMARY.md`.
 *
 * ## Cook flag surface (audit per task 1 verify)
 *
 * Verified against `packages/cli/src/commands/cook.ts:detectModeFromFlags`
 * (lines 657-692, last touched in Phase 03 plan 03-02). The cook flag
 * surface for the 7 aliased modes is:
 *
 *  - `--plan` (string, optional NN target) → mode `plan`
 *  - `--execute` (boolean)                 → mode `execute`
 *  - `--discuss` (boolean)                 → mode `discuss`
 *  - `--assumptions` (boolean)             → mode `assumptions`
 *  - `--archive` (boolean)                 → mode `archive`
 *  - `--add` / `--insert` / `--remove`     → modes `add-phase`/`insert-phase`/`remove-phase`
 *  - `--audit` — **does NOT exist** as a standalone cook flag. The pre-
 *    archive audit gate runs as part of the `--archive` flow (cook.ts:904
 *    "All phases complete. Run audit and archive?"). The `audit` alias
 *    here maps to `--archive` for now; it triggers the audit gate as a
 *    side-effect but also runs the archive flow. A future
 *    `--audit-only` flag on cook would let `audit` be truly standalone.
 *    Documented as DEVN-02 partial in the plan summary.
 *
 * The `phase` verb is a no-op forwarder: the argv parser already maps
 * `--add "X"` / `--insert "N"` / `--remove "N"` directly into
 * `parsed.flags`, and `detectModeFromFlags` already routes them. So
 * `phaseAlias` just passes through.
 */

import type { ParsedArgv } from '../argv.js';
import type { ExitCode } from '../exit-codes.js';
import type { CommandIO } from '../router.js';

import { cookHandler } from '../commands/cook.js';

/**
 * Cook boolean flags this helper can set on a forwarded `ParsedArgv`.
 * Excludes `--plan` (which is a string-valued flag with an optional NN
 * target — callers pass the user-supplied positionals through unchanged).
 */
export type CookBooleanFlag =
  | 'execute'
  | 'discuss'
  | 'assumptions'
  | 'archive'
  | 'verify'
  | 'scope';

/**
 * Forward `parsed` to `cookHandler` with `cookFlag` set on `parsed.flags`.
 *
 * The verb is rewritten to `'cook'` (mirrors `discussHandler` /
 * `debugHandler` shape from Plan 06-05 T4). All other positionals + flags
 * propagate unchanged — `--effort fast`, `--skip-qa`, etc. all flow through
 * to cook untouched.
 *
 * Returns whatever `cookHandler` returns (its `Promise<ExitCode>` or
 * sync `ExitCode`); the caller's promise-or-sync return type is
 * preserved so byte-identical output via stdout/stderr handed to `io` is
 * automatic.
 */
export function aliasToCook(
  parsed: ParsedArgv,
  io: CommandIO,
  cookFlag: CookBooleanFlag,
): Promise<ExitCode> | ExitCode {
  const shimmedFlags: ParsedArgv['flags'] = { ...parsed.flags, [cookFlag]: true };
  const shimmed: ParsedArgv = {
    verb: 'cook',
    positionals: parsed.positionals,
    flags: shimmedFlags,
  };
  return cookHandler(shimmed, io);
}

/**
 * Variant of `aliasToCook` for the `--plan` flag, which is string-valued
 * (carries an optional phase NN target) rather than boolean. If the user
 * runs `swt plan 03 --effort fast`, the first positional becomes the
 * plan target value; otherwise the flag is set to the empty string so
 * `detectModeFromFlags`'s `planFlag !== undefined` check still fires.
 */
export function aliasToCookPlan(
  parsed: ParsedArgv,
  io: CommandIO,
): Promise<ExitCode> | ExitCode {
  // The cook argv parser accepts `--plan` (bare), `--plan NN`, and
  // `--plan=NN` all as a string flag (possibly empty). Forward the
  // positional NN — if present — into the flag value so cook's
  // `planTarget` extraction (cook.ts:670) sees it.
  const positionalTarget = parsed.positionals[0];
  const planValue =
    typeof positionalTarget === 'string' && positionalTarget.length > 0 ? positionalTarget : '';
  const shimmedFlags: ParsedArgv['flags'] = { ...parsed.flags, plan: planValue };
  const shimmed: ParsedArgv = {
    verb: 'cook',
    // When a positional was consumed into the --plan value, drop it
    // from positionals so cook doesn't re-consume it as free-text.
    positionals: planValue !== '' ? parsed.positionals.slice(1) : parsed.positionals,
    flags: shimmedFlags,
  };
  return cookHandler(shimmed, io);
}

/**
 * The `phase` verb dispatcher.
 *
 * `swt phase --add "X"` / `--insert N "X"` / `--remove N` need no flag
 * translation: the argv parser already places `--add` / `--insert` /
 * `--remove` directly into `parsed.flags` as string values, and cook's
 * `detectModeFromFlags` already routes each to the matching mode (lines
 * 686-688). So `phaseAlias` is a no-op forwarder — it rewrites the verb
 * to `'cook'` and hands off to `cookHandler` with `parsed` unchanged
 * otherwise.
 *
 * If none of `--add` / `--insert` / `--remove` is set, cook will fall
 * through to its state-driven routing (the 11-priority table). That's
 * intentional: bare `swt phase` should report whatever phase work is
 * pending, matching the documented VBW `/vbw:phase` semantics.
 */
export function phaseAlias(
  parsed: ParsedArgv,
  io: CommandIO,
): Promise<ExitCode> | ExitCode {
  const shimmed: ParsedArgv = {
    verb: 'cook',
    positionals: parsed.positionals,
    flags: parsed.flags,
  };
  return cookHandler(shimmed, io);
}
