/**
 * `loadAgentsMd` — Phase 17 plan 03-01 Task 1 — AGENTS.md hierarchical loader.
 *
 * Implements Codex's `AgentsMdManager` walk-up algorithm verbatim per Scout
 * §A.1 + `a_non_production_files/codex-main/codex-rs/core/src/agents_md.rs`:
 *
 *   1. Resolve `cwd` to an absolute path.
 *   2. Walk ancestors upward looking for the FIRST `.git` marker. That
 *      ancestor (or the deepest one matching) is `projectRoot`.
 *   3. If no `.git` marker is found anywhere, `projectRoot = cwd`
 *      (cwd-only fallback).
 *   4. Build `searchDirs = [projectRoot, ..., cwd]` (root-first, cwd-last
 *      inclusive). Walking from cwd up to projectRoot, then reversing.
 *   5. For each `dir`, iterate `['AGENTS.override.md', 'AGENTS.md']` in
 *      order. The FIRST file that exists wins — `break` after match.
 *      `AGENTS.override.md` REPLACES `AGENTS.md` at the same directory
 *      level (Scout §A.1 + §D). Empty / whitespace-only files contribute
 *      nothing.
 *
 * Error handling (Scout §A.1 step "Missing-file behavior"):
 *   - `ENOENT` (file not found) → silent `continue`. Normally pre-checked
 *     by `existsSync` so this is a race-condition guard only.
 *   - Any other I/O error (permission denied, etc.) → one `console.warn`
 *     per file, then `continue`. The error is NEVER thrown out of the
 *     loader; Codex's `tracing::error!` path is equivalent — the model
 *     just sees the AGENTS.md content omitted.
 *
 * Return shape:
 *   - `readonly string[]` — one element per non-empty contributing level,
 *     in root-first order. The consumer (`CodexViaOverlayPack.contextFiles`)
 *     returns the array as-is per `ProviderTuningPack.contextFiles`'s
 *     `readonly string[]` contract. Consumers that want a single joined
 *     string can `parts.join('\n\n')` at the prepend site — `defaultSpawn
 *     SessionFactory` does exactly that.
 *   - Empty walk (no AGENTS.md anywhere, OR all files empty) → `[]`.
 *
 * Anchored to `node:fs` + `node:path` only — zero non-stdlib dependencies,
 * synchronous I/O matches Codex's blocking spec (the resolver runs once at
 * session-start, never on the hot turn path).
 *
 * D2 / D4 / Scout §A.1 — only consumed by `CodexViaOverlayPack` today;
 * `AnthropicViaPiPack.contextFiles()` still returns `[]` (D2 isolation).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CANDIDATE_FILENAMES = ['AGENTS.override.md', 'AGENTS.md'] as const;

/**
 * Walk ancestors from `cwd` upward, returning the deepest ancestor where a
 * `.git` marker exists. Returns `null` when no marker is found anywhere in
 * the chain (signalling the cwd-only fallback per Scout §A.1 step 3).
 *
 * Codex's algorithm returns the FIRST ancestor (closest to cwd) where the
 * marker exists — for a typical monorepo with one `.git` at the repo root,
 * this is the repo root. For nested repos, the nearest `.git` wins.
 */
function findProjectRoot(cwd: string): string | null {
  let current = cwd;
  // Iterate at most until the filesystem root. `dirname('/')` returns '/'
  // on POSIX and the drive root on Windows, so a fixed-point detector
  // (`previous === current`) is the correct termination condition.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = join(current, '.git');
    if (existsSync(candidate)) {
      // `.git` can be a directory (worktree root) OR a regular file
      // (git submodule / linked worktree). Either qualifies per Codex's
      // `agents_md.rs` (checks via `fs.get_metadata` regardless of kind).
      try {
        statSync(candidate);
        return current;
      } catch {
        // Race condition: file disappeared between existsSync and
        // statSync. Treat as not-found and continue walking.
      }
    }
    const parent = join(current, '..');
    const resolvedParent = resolve(parent);
    if (resolvedParent === current) {
      // Reached filesystem root without finding `.git`.
      return null;
    }
    current = resolvedParent;
  }
}

/**
 * Build the ordered list of directories to inspect for AGENTS.md files.
 * Order is root-first → cwd-last, inclusive at both ends.
 *
 * - `projectRoot === cwd`  → `[cwd]` only.
 * - `projectRoot` ancestor → walk from cwd up to projectRoot collecting
 *   each intermediate dir, then reverse so the result is
 *   `[projectRoot, ..., cwd]`.
 */
function buildSearchDirs(cwd: string, projectRoot: string): string[] {
  if (projectRoot === cwd) {
    return [cwd];
  }
  const dirs: string[] = [];
  let current = cwd;
  // Walk up until we hit (and include) projectRoot. The fixed-point
  // detector also protects against an unexpected mismatched-path case
  // where `projectRoot` is not actually an ancestor.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    dirs.push(current);
    if (current === projectRoot) break;
    const parent = resolve(join(current, '..'));
    if (parent === current) {
      // Reached filesystem root without hitting projectRoot — bail
      // defensively. Should not happen in well-formed input.
      break;
    }
    current = parent;
  }
  return dirs.reverse();
}

/**
 * Load AGENTS.md content from `cwd` upward, root-first.
 *
 * @param opts.cwd — absolute or relative path to the working directory.
 *   Relative paths are resolved to absolute via `path.resolve(cwd)`.
 * @returns Ordered array of non-empty file contents (one element per
 *   directory level that contributed). Empty array when no AGENTS.md /
 *   AGENTS.override.md exists in the walk path (or every match is empty).
 */
export function loadAgentsMd(opts: { cwd: string }): readonly string[] {
  const cwd = resolve(opts.cwd);

  // If cwd doesn't exist at all, treat as cwd-only-fallback with no
  // contributions. Codex's behavior on a nonexistent cwd is to bail
  // silently (the directory listing fails); we mirror by returning [].
  if (!existsSync(cwd)) {
    return [];
  }

  const projectRoot = findProjectRoot(cwd);
  const searchDirs = projectRoot === null ? [cwd] : buildSearchDirs(cwd, projectRoot);

  const fragments: string[] = [];
  for (const dir of searchDirs) {
    for (const candidate of CANDIDATE_FILENAMES) {
      const filePath = join(dir, candidate);
      if (!existsSync(filePath)) continue;

      let body: string;
      try {
        body = readFileSync(filePath, 'utf8');
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr && nodeErr.code === 'ENOENT') {
          // Race condition: existsSync said yes, readFileSync says no.
          // Silent continue per Codex's ENOENT semantics.
          continue;
        }
        // Other I/O errors (EACCES, EISDIR, etc.) — log once and skip.
        // Do NOT surface the error to the model; Codex's tracing::error!
        // path is equivalent (logged, content omitted).
        console.warn(
          `[agents-md-loader] Failed to read ${filePath}: ${nodeErr?.message ?? String(err)}`,
        );
        continue;
      }

      // Skip empty / whitespace-only files (Scout §A.1 — Codex's
      // `read_agents_md` excludes them from the join).
      if (body.trim().length === 0) {
        break; // override match consumes the slot even when empty
      }

      fragments.push(body);
      break; // first-hit-wins: AGENTS.override.md preempts AGENTS.md
    }
  }

  return fragments;
}
