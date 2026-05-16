/**
 * `readProjectAuthConfig` — the auth-block slice of `.swt-planning/config.json`.
 *
 * Plan 01-01 (Milestone 12 — Free-talk mode). The dashboard L7 chat route
 * (plan 01-03) needs `config.auth` to drive `resolveSpawnCredential` but does
 * NOT need providers/budget/qa_gate_overrides — those stay parsed by
 * `loadCookConfig` in `@swt-labs/cli`. This helper exposes ONLY the auth-block
 * slice at the runtime layer (L2) so the dashboard can read it without
 * importing `@swt-labs/cli` (an L7→L6 layer violation).
 *
 * Behaviour for the auth block is BYTE-IDENTICAL to `loadCookConfig`
 * (cook.ts:1276-1333) — the same defensive-parse discipline:
 *
 *   - Missing `.swt-planning/config.json` → `DEFAULT_AUTH_CONFIG` (`{}`).
 *   - Malformed JSON → `DEFAULT_AUTH_CONFIG` (graceful degrade, never throws).
 *   - Valid JSON → `parseAuthConfig(parsed['auth'])` — exactly the same call
 *     `loadCookConfig` makes on the same sub-key.
 *
 * The `fsImpl` parameter mirrors `loadCookConfig`'s test seam — production
 * callers omit it; unit tests inject a stub to avoid real filesystem IO.
 */

import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { DEFAULT_AUTH_CONFIG, parseAuthConfig, type AuthConfig } from './auth-config.js';

/**
 * Read the `auth` sub-block of a project's `.swt-planning/config.json`.
 * Returns the parsed `AuthConfig` (which may itself be `{}`) on success; the
 * `DEFAULT_AUTH_CONFIG` (`{}`) on missing file / unreadable file / malformed
 * JSON. NEVER throws — preserves the graceful-degrade contract of the
 * `loadCookConfig` auth-block slice it mirrors.
 *
 * `parseAuthConfig` is itself defensive (drops malformed entries, never
 * throws), so a structurally-valid JSON with a malformed `auth` value yields
 * `DEFAULT_AUTH_CONFIG` rather than a thrown error or an `{auth: undefined}`
 * row.
 *
 * @param projectRoot Absolute path to the project root (the directory that
 *   contains `.swt-planning/`).
 * @param fsImpl Test seam — production callers omit it.
 */
export function readProjectAuthConfig(
  projectRoot: string,
  fsImpl: {
    readFileSync: typeof nodeReadFileSync;
    existsSync: typeof nodeExistsSync;
  } = {
    readFileSync: nodeReadFileSync,
    existsSync: nodeExistsSync,
  },
): AuthConfig {
  const configPath = resolvePath(projectRoot, '.swt-planning', 'config.json');
  if (!fsImpl.existsSync(configPath)) {
    return DEFAULT_AUTH_CONFIG;
  }
  try {
    const raw = fsImpl.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parseAuthConfig(parsed['auth']);
  } catch {
    return DEFAULT_AUTH_CONFIG;
  }
}
