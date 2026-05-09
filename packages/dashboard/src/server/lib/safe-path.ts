import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface SafePathOptions {
  /** Project root the request is scoped to. Absolute. */
  projectRoot: string;
  /** Relative-path prefixes that are allowed (e.g. ['.swt-planning/', 'dist/']). */
  allowlist: readonly string[];
  /** Optional: max file size in bytes. Default 10MB. */
  maxBytes?: number;
}

export type SafePathResult =
  | { ok: true; absPath: string; relPath: string; size: number }
  | { ok: false; status: 400 | 404; reason: string };

/**
 * Validate a user-supplied {requested} path against the project root + allowlist.
 * Returns ok with absPath when the path resolves to a regular file inside the
 * allowlist; otherwise returns a 400 (traversal/policy) or 404 (missing).
 *
 * Defends against:
 *  - `../../etc/passwd` and equivalents
 *  - URL-encoded traversal (`%2e%2e%2f`) — caller must decode first; this fn
 *    treats any input as already-decoded but normalizes via `path.posix.normalize`
 *    so `./a/../b` collapses to `b`
 *  - absolute paths (rejected — must be project-relative)
 *  - directory paths (only files allowed)
 *  - symlinks pointing outside the project root (statSync follows symlinks;
 *    we verify the realpath is still under projectRoot)
 *  - oversized files (>{maxBytes})
 */
export function resolveSafePath(requested: string, options: SafePathOptions): SafePathResult {
  const { projectRoot, allowlist } = options;
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES;

  if (!requested || typeof requested !== 'string') {
    return { ok: false, status: 400, reason: 'path query param is required' };
  }
  if (path.isAbsolute(requested)) {
    return { ok: false, status: 400, reason: 'absolute paths not allowed' };
  }

  // Normalize first via POSIX semantics so `\..\` on Windows can't sneak past.
  const normalizedPosix = path.posix.normalize(requested.replace(/\\/g, '/'));
  if (normalizedPosix.startsWith('..') || normalizedPosix.includes('/../')) {
    return { ok: false, status: 400, reason: 'path traversal rejected' };
  }

  const allowed = allowlist.some(
    (prefix) => normalizedPosix === prefix.replace(/\/$/, '') || normalizedPosix.startsWith(prefix),
  );
  if (!allowed) {
    return { ok: false, status: 400, reason: 'path outside allowlist' };
  }

  const absRoot = path.resolve(projectRoot);
  const absPath = path.resolve(absRoot, normalizedPosix);
  if (!absPath.startsWith(absRoot + path.sep) && absPath !== absRoot) {
    return { ok: false, status: 400, reason: 'resolved path escapes project root' };
  }

  if (!existsSync(absPath)) {
    return { ok: false, status: 404, reason: 'file not found' };
  }

  let stats;
  try {
    stats = statSync(absPath);
  } catch {
    return { ok: false, status: 404, reason: 'file not stat-able' };
  }
  if (!stats.isFile()) {
    return { ok: false, status: 400, reason: 'path is not a regular file' };
  }
  if (stats.size > maxBytes) {
    return { ok: false, status: 400, reason: `file exceeds ${maxBytes} bytes` };
  }

  return {
    ok: true,
    absPath,
    relPath: path.relative(absRoot, absPath),
    size: stats.size,
  };
}
