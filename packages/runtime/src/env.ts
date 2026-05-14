/**
 * Pi-substrate primitive 5 + 6 — `swt:installRoot()` and `swt:sessionId()`.
 *
 * These resolvers populate `process.env.SWT_INSTALL_ROOT` and
 * `process.env.SWT_SESSION_ID` at CLI bootstrap so every spawned bash script,
 * hook handler, and Pi session inherits the same paired env. They replace the
 * VBW-era `CLAUDE_PLUGIN_ROOT` / `CLAUDE_SESSION_ID` contract (TDD3 §3).
 *
 * Resolution order — `resolveInstallRoot()`:
 *   1. `process.env.SWT_INSTALL_ROOT` (explicit operator override wins).
 *   2. Walk up from `dirname(fileURLToPath(import.meta.url))` looking for a
 *      `package.json` whose `name` is `stop-wasting-tokens`, OR a sibling
 *      `scripts/` directory containing `bash-guard.sh`. Same shape as
 *      `packages/cli/src/commands/dashboard.ts` uses to find the dashboard
 *      bundle (research §2.5).
 *   3. Throw — operator must set `SWT_INSTALL_ROOT` explicitly.
 *
 * Resolution order — `resolveSessionId()`:
 *   1. `process.env.SWT_SESSION_ID` (explicit override — e.g. parent CLI
 *      spawned a child).
 *   2. `globalThis.crypto.randomUUID()` — generated once per process and
 *      cached at module scope so repeated calls return the same UUID.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'stop-wasting-tokens';

let cachedSessionId: string | null = null;

function walkUpForInstallRoot(startDir: string): string | null {
  let current = resolve(startDir);
  // Hard stop: a non-existent directory or root. `dirname('/')` === '/' so
  // the loop terminates on the first iteration that does not advance.
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
        // Unreadable / invalid JSON — keep walking. Better than throwing on
        // a transient parse error halfway up the tree.
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

/**
 * Resolve the SWT install root — the package directory containing
 * `scripts/`, `agents/`, `templates/`, etc.
 *
 * @throws {Error} when neither the env override nor the import.meta.url walk
 *   resolves to a recognizable install root.
 */
export function resolveInstallRoot(): string {
  const envOverride = process.env.SWT_INSTALL_ROOT;
  if (typeof envOverride === 'string' && envOverride.length > 0) {
    return envOverride;
  }

  // `import.meta.url` resolves to this very source file at build time; in
  // dev it's `packages/runtime/src/env.ts`, in published builds it's the
  // bundled JS adjacent to `dist/cli.mjs`. Either way, walking up reaches
  // the install root.
  let here: string;
  try {
    here = fileURLToPath(import.meta.url);
  } catch (err) {
    throw new Error(
      `swt:installRoot — unable to resolve from import.meta.url (${
        err instanceof Error ? err.message : String(err)
      }). Set SWT_INSTALL_ROOT explicitly.`,
    );
  }

  const resolved = walkUpForInstallRoot(dirname(here));
  if (resolved === null) {
    throw new Error(
      `swt:installRoot — could not locate the SWT package root by walking up from ${here}. ` +
        `Expected to find package.json with name="${PACKAGE_NAME}" or a sibling scripts/bash-guard.sh. ` +
        `Set SWT_INSTALL_ROOT explicitly if your install layout is non-standard.`,
    );
  }
  return resolved;
}

/**
 * Resolve the current SWT session ID — a UUID v4 generated once per process
 * and reused for every call within that process.
 *
 * Honors `process.env.SWT_SESSION_ID` when set (e.g. a parent CLI spawned a
 * child and wants both processes to share a session). Cached at module
 * scope so two callers in the same process always observe the same value.
 */
export function resolveSessionId(): string {
  const envOverride = process.env.SWT_SESSION_ID;
  if (typeof envOverride === 'string' && envOverride.length > 0) {
    // Cache it too so the override is sticky even if the env is later
    // mutated mid-process (vi.stubEnv, child process tweaks, ...).
    if (cachedSessionId === null) cachedSessionId = envOverride;
    return cachedSessionId;
  }

  if (cachedSessionId !== null) return cachedSessionId;

  cachedSessionId = globalThis.crypto.randomUUID();
  return cachedSessionId;
}

/**
 * Apply both resolvers' results to `process.env` so spawned children inherit
 * the canonical pair. Idempotent — calling twice in the same process
 * returns the same values and does not regenerate the UUID.
 *
 * Returns the resolved pair so callers can thread it into structured
 * loggers / event buses without re-reading `process.env`.
 */
export function applyEnvToProcess(): { installRoot: string; sessionId: string } {
  const installRoot = resolveInstallRoot();
  const sessionId = resolveSessionId();
  // Only write if not already populated — preserves explicit operator overrides
  // and avoids surprise mutation of an env that's already correct.
  if (
    typeof process.env.SWT_INSTALL_ROOT !== 'string' ||
    process.env.SWT_INSTALL_ROOT.length === 0
  ) {
    process.env.SWT_INSTALL_ROOT = installRoot;
  }
  if (typeof process.env.SWT_SESSION_ID !== 'string' || process.env.SWT_SESSION_ID.length === 0) {
    process.env.SWT_SESSION_ID = sessionId;
  }
  return { installRoot, sessionId };
}

/**
 * Test-only: reset the cached sessionId so vitest cases can exercise the
 * UUID-generation path under a clean module state. Not exported from
 * `packages/runtime/src/index.ts` — internal to the test suite via direct
 * import of `env.js`.
 */
export function __resetSessionIdCacheForTests(): void {
  cachedSessionId = null;
}
