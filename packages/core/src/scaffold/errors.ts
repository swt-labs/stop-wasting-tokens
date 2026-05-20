/**
 * Shared helper for the scaffold helpers that wrap shell scripts via
 * `execFileSync`. `execFileSync` attaches a `stderr` property (string or
 * Buffer) to the thrown Error on non-zero exit; this helper extracts a
 * safe string representation without tripping `@typescript-eslint/no-base-
 * to-string` (which forbids `String(unknown)` because non-strings would
 * stringify to `'[object Object]'`).
 *
 * Plan 23-01-01 T03 — extracted from the four scaffold helpers
 * (init-git/run-detect-stack/sync-gitignore/install-git-hooks/bootstrap-
 * claude-md) to a single co-located helper so the lint rule stays clean
 * workspace-wide and future scaffold wrappers reuse the same shape.
 */

/**
 * Extract the `stderr` field from an `execFileSync` failure (or any
 * thrown value that carries one). Returns the empty string when no
 * usable `stderr` is present.
 */
export function extractStderr(err: unknown): string {
  if (err === null || typeof err !== 'object') return '';
  const raw = (err as { stderr?: unknown }).stderr;
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
    return Buffer.from(raw).toString('utf8');
  }
  return '';
}
