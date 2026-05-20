/**
 * Statusline v2 (statusline_v2.md) Wave 5 commit 9 — git project-identity
 * detection for the leftmost `repo:` + `branch:` statusline cells.
 *
 * `detectGitInfo(cwd)` returns a `GitInfo` payload when `cwd` is inside
 * a git repository, or `undefined` for non-git workspaces (SWT can
 * manage either; the cells just hide when the field is absent).
 *
 * Reads at startup + on FS-watcher events; not in the hot path. The
 * branch + detached state read directly from `.git/HEAD` (no shell-out),
 * while the remote URL + short SHA require `git config` / `git rev-parse`
 * subprocesses. Failures in the subprocess paths degrade gracefully —
 * the cells still render `repo: <basename>` and `branch: <name>` from
 * the `.git/HEAD` read alone.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { GitInfo } from '@swt-labs/shared';

/**
 * Inspect `cwd` and return git project-identity, or `undefined` when
 * the cwd is not inside a git repository.
 *
 * Robust to:
 *   - non-git workspaces (no `.git/`)
 *   - bare repos with `.git` as a FILE (gitlink) — unwound via the
 *     `gitdir:` prefix
 *   - detached HEAD (no `ref:` in `.git/HEAD`)
 *   - missing `git` on PATH or corrupt repo (subprocess paths fail
 *     gracefully; the cells degrade to `.git/HEAD`-only data)
 */
export function detectGitInfo(cwd: string): GitInfo {
  const gitDir = resolveGitDir(cwd);
  if (gitDir === null) return undefined;

  const head = readGitHead(gitDir);
  if (head === null) return undefined;

  const branch = head.branch;
  const detached = head.detached;

  let short_sha = '';
  try {
    short_sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    short_sha = '';
  }

  let repo_url_path: string | null = null;
  try {
    const remoteUrl = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    repo_url_path = parseRepoPath(remoteUrl);
  } catch {
    repo_url_path = null;
  }

  const repo_basename = path.basename(cwd);

  return {
    repo_url_path,
    repo_basename,
    branch,
    detached,
    short_sha,
  };
}

/**
 * Walk the cwd's `.git` and return the resolved git directory, handling
 * the two layouts:
 *
 *   - regular repos: `.git/` is a directory; return it.
 *   - worktrees / submodules: `.git` is a file containing `gitdir: <path>`
 *     which points to the real git dir. Return that path.
 *
 * Returns `null` when `.git` is absent or unreadable.
 */
function resolveGitDir(cwd: string): string | null {
  const dotGit = path.join(cwd, '.git');
  if (!existsSync(dotGit)) return null;
  let stat;
  try {
    stat = statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  if (stat.isFile()) {
    try {
      const contents = readFileSync(dotGit, 'utf8').trim();
      const match = contents.match(/^gitdir:\s*(.+)$/m);
      const captured = match?.[1];
      if (captured) {
        const target = captured.trim();
        return path.isAbsolute(target) ? target : path.resolve(cwd, target);
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Read `<gitDir>/HEAD` and parse the branch state. Returns:
 *   - `{ branch: '<name>', detached: false }` for a normal checkout
 *   - `{ branch: null,     detached: true  }` for a detached HEAD (HEAD
 *     contains a bare SHA)
 *   - `null` if the file is missing or malformed
 */
function readGitHead(gitDir: string): { branch: string | null; detached: boolean } | null {
  const headPath = path.join(gitDir, 'HEAD');
  if (!existsSync(headPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(headPath, 'utf8').trim();
  } catch {
    return null;
  }
  const refMatch = raw.match(/^ref:\s+refs\/heads\/(.+)$/);
  const capturedBranch = refMatch?.[1];
  if (capturedBranch) {
    return { branch: capturedBranch, detached: false };
  }
  // Bare SHA → detached HEAD. Accept 7-40 hex chars defensively.
  if (/^[0-9a-fA-F]{7,40}$/.test(raw)) {
    return { branch: null, detached: true };
  }
  return null;
}

/**
 * Parse an origin URL into `<org>/<repo>` (e.g. "swt-labs/stop-wasting-tokens").
 *
 * Accepts both shapes:
 *   - HTTPS: `https://github.com/swt-labs/stop-wasting-tokens(.git)?`
 *   - SSH:   `git@github.com:swt-labs/stop-wasting-tokens(.git)?`
 *
 * Returns `null` for non-GitHub URLs or unparseable inputs. The Project
 * cells then fall back to `repo_basename` for display, and the tooltip
 * surfaces the unparsed URL.
 */
export function parseRepoPath(remoteUrl: string): string | null {
  // Anchor at the URL scheme so bare `github.com/foo/bar` (no scheme)
  // doesn't accidentally match — `git config --get remote.origin.url`
  // always returns a fully-qualified URL, so the bare form is treated
  // as malformed input and rejected.
  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch?.[1]) return httpsMatch[1];
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch?.[1]) return sshMatch[1];
  return null;
}
