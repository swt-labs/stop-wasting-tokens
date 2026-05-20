/**
 * `writeConfigJson` — write `.swt-planning/config.json` by deep-merging the
 * shipped `config/defaults.json` with the caller's `planning_tracking` +
 * `auto_push` overrides.
 *
 * Plan 01-01 (milestone 23, Phase 01 T01). The previous `initProject()` did
 * NOT write a config.json at all — the dashboard's pre-init provider-auth
 * route was the sole writer (via `mkdir -p .swt-planning && writeFile
 * config.json`). With milestone 23's "synchronous scaffold" rewrite, the
 * wizard collects `planning_tracking` + `auto_push` upfront in Step 2 and
 * passes them through `/api/init` → `initProject()` → this helper, which
 * persists a full defaults-derived config so subsequent SWT runs read a
 * complete schema-valid file.
 *
 * Resolution order for `defaults.json`:
 *   1. `${pluginRoot}/config/defaults.json` when `pluginRoot` is provided.
 *   2. Walk up from `import.meta.url` to find a `config/defaults.json`
 *      adjacent to a `package.json` named `stop-wasting-tokens` OR adjacent
 *      to a `scripts/bash-guard.sh`. Mirrors the resolution shape used in
 *      `@swt-labs/runtime/src/env.ts` so the L1 helper stays local (no
 *      upward import into runtime).
 *   3. Throw — operator must set up the tarball layout or pass `pluginRoot`.
 *
 * Deep merge semantics: top-level scalar/array keys from the caller's
 * overrides replace the corresponding defaults; nested objects (e.g.
 * `agent_max_turns`) are NOT recursed because the Phase 01 overrides only
 * touch top-level keys. This mirrors the wizard's Step 2 surface which
 * collects exactly `planning_tracking` + `auto_push` as flat enums.
 *
 * NO async/await — all I/O is synchronous (`readFileSync`, `writeFileSync`).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'stop-wasting-tokens';

export interface WriteConfigJsonOptions {
  /** Absolute project root containing `.swt-planning/`. */
  readonly cwd: string;
  /**
   * Optional plugin root override. When provided, `${pluginRoot}/config/defaults.json`
   * is read directly. When omitted, the helper walks up from `import.meta.url`.
   */
  readonly pluginRoot?: string;
  /**
   * Planning-tracking mode the wizard collected in Step 2. Wraps the
   * `planning_tracking` key in `defaults.json`. When omitted, the default
   * (from defaults.json) is preserved.
   */
  readonly planningTracking?: 'manual' | 'ignore' | 'commit';
  /**
   * Auto-push mode the wizard collected in Step 2. Wraps the `auto_push`
   * key in `defaults.json`. When omitted, the default is preserved.
   */
  readonly autoPush?: 'never' | 'after_phase' | 'always';
}

function walkUpForPluginRoot(startDir: string): string | null {
  let current = resolve(startDir);
  for (;;) {
    const pkgPath = `${current}${sep}package.json`;
    if (existsSync(pkgPath)) {
      try {
        const raw = readFileSync(pkgPath, 'utf8');
        const parsed = JSON.parse(raw) as { name?: unknown };
        if (typeof parsed.name === 'string' && parsed.name === PACKAGE_NAME) {
          return current;
        }
      } catch {
        // Unreadable / invalid JSON — keep walking.
      }
    }
    const scriptsGuard = `${current}${sep}scripts${sep}bash-guard.sh`;
    if (existsSync(scriptsGuard)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolvePluginRoot(pluginRoot: string | undefined): string {
  if (typeof pluginRoot === 'string' && pluginRoot.length > 0) {
    return pluginRoot;
  }
  let here: string;
  try {
    here = fileURLToPath(import.meta.url);
  } catch (err) {
    throw new Error(
      `writeConfigJson: unable to resolve plugin root from import.meta.url (${
        err instanceof Error ? err.message : String(err)
      }). Pass pluginRoot explicitly.`,
    );
  }
  const resolved = walkUpForPluginRoot(dirname(here));
  if (resolved === null) {
    throw new Error(
      `writeConfigJson: could not locate the SWT plugin root by walking up from ${here}. ` +
        `Expected to find package.json with name="${PACKAGE_NAME}" or a sibling scripts/bash-guard.sh. ` +
        `Pass pluginRoot explicitly when initialising from a non-standard layout.`,
    );
  }
  return resolved;
}

/**
 * Write `.swt-planning/config.json` from the shipped `defaults.json` with
 * the caller's overrides applied. Returns the absolute path to the file.
 *
 * Pre-existing `config.json` (e.g. from a pre-init provider-auth save) is
 * READ FIRST so its keys (notably `auth`/`providers`) are preserved as a
 * third merge layer beneath defaults + overrides. This mirrors the
 * milestone-19 "provider auth before naming the project" bug-fix path:
 * the user must not lose their keychain wiring when initProject() runs.
 */
export function writeConfigJson(options: WriteConfigJsonOptions): string {
  const pluginRoot = resolvePluginRoot(options.pluginRoot);
  const defaultsPath = `${pluginRoot}${sep}config${sep}defaults.json`;
  let defaults: Record<string, unknown>;
  try {
    const raw = readFileSync(defaultsPath, 'utf8');
    defaults = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `writeConfigJson: failed to read ${defaultsPath} (${
        err instanceof Error ? err.message : String(err)
      }).`,
    );
  }

  const configPath = `${options.cwd}${sep}.swt-planning${sep}config.json`;
  let preExisting: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        preExisting = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt / unparseable pre-existing config — fall back to defaults.
    }
  }

  // Top-level merge: defaults ← preExisting ← explicit overrides. The
  // pre-existing layer carries keys that only the dashboard's provider-auth
  // route writes (auth, providers); defaults supplies every wizard-relevant
  // key; the overrides apply the wizard's Step 2 collection on top.
  const merged: Record<string, unknown> = { ...defaults, ...preExisting };
  if (options.planningTracking !== undefined) {
    merged.planning_tracking = options.planningTracking;
  }
  if (options.autoPush !== undefined) {
    merged.auto_push = options.autoPush;
  }

  // 2-space indent + trailing newline matches the existing `JSON.stringify`
  // style used elsewhere in the package (e.g. config-store writes).
  const out = `${JSON.stringify(merged, null, 2)}\n`;
  writeFileSync(configPath, out, 'utf8');
  return configPath;
}
