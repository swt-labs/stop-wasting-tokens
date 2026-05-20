/**
 * `initGit` + `detectGitState` — git-repo detection + silent auto-init.
 *
 * Plan 23-01-01 T02 (milestone 23, Phase 01). The wizard's "synchronous
 * scaffold" promise REQUIRES init to behave gracefully whether the user
 * already has a `.git` (in cwd or in a parent monorepo) or not:
 *
 *   - `.git/` in cwd        → SKIP init (idempotent — the user already has
 *                             a repo).
 *   - `.git/` in a parent   → SKIP init (working inside a parent monorepo
 *                             — STATE.md activity log notes the parent).
 *   - no `.git/` anywhere   → run `git init` silently.
 *
 * Both helpers use `execFileSync` with `stdio: 'pipe'` so output never
 * leaks to the dashboard's stdout. Exit-code-1 from `git rev-parse` is
 * Pi-substrate-style "not a repo" — translated to `'none'` here.
 *
 * `detectGitState` is the pure read-only sibling used by `/api/init-precheck`
 * (T03). It returns the same shape minus the `initialized: boolean` field
 * because it never runs `git init`.
 */

import { execFileSync, execSync } from 'node:child_process';

export type GitAlreadyExists = 'cwd' | 'parent' | 'none';
export type GitState = 'repo' | 'absent' | 'parent_repo';

export interface InitGitResult {
  /** `true` only when THIS call ran `git init`. */
  readonly initialized: boolean;
  /**
   * Detected git state at call time:
   *   - `'cwd'`    — `.git/` was already in `cwd` (init skipped).
   *   - `'parent'` — `.git/` is in a parent directory (init skipped).
   *   - `'none'`   — no `.git/` anywhere (init ran iff opts.initGit !== false).
   */
  readonly alreadyExists: GitAlreadyExists;
  /**
   * When `alreadyExists === 'parent'`, the absolute path to the parent
   * `.git/` dir. Used by `init-project.ts` to append a STATE.md
   * activity-log line per AC 13. Empty string otherwise.
   */
  readonly parentRepoPath: string;
}

function gitRevParseGitDir(cwd: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { ok: true, output: output.trim() };
  } catch {
    return { ok: false, output: '' };
  }
}

function gitToplevel(cwd: string): string {
  try {
    const output = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return output.trim();
  } catch {
    return '';
  }
}

function classifyGitDirOutput(
  cwd: string,
  raw: string,
): { alreadyExists: GitAlreadyExists; parentRepoPath: string } {
  // `git rev-parse --git-dir` returns either:
  //   - `.git` (relative — repo in cwd)
  //   - an absolute path ending in `/.git` (when running inside the same
  //     repo from a subdir or when the cwd is its own repo and git uses
  //     absolute paths under newer versions)
  //   - an absolute path ending in `/.git` from a parent (when cwd is
  //     inside a parent monorepo)
  //
  // The most reliable disambiguator is comparing `git rev-parse
  // --show-toplevel` against `cwd`: equal ⇒ cwd-repo; non-empty + different
  // ⇒ parent-repo.
  const toplevel = gitToplevel(cwd);
  if (toplevel.length > 0) {
    // Normalize trailing slashes for comparison.
    const normTop = toplevel.replace(/\/+$/u, '');
    const normCwd = cwd.replace(/\/+$/u, '');
    if (normTop === normCwd) {
      return { alreadyExists: 'cwd', parentRepoPath: '' };
    }
    return { alreadyExists: 'parent', parentRepoPath: normTop };
  }
  // toplevel empty but rev-parse succeeded — treat as cwd-repo (safest;
  // skip init).
  return raw === '.git' || raw.endsWith('/.git')
    ? { alreadyExists: 'cwd', parentRepoPath: '' }
    : { alreadyExists: 'cwd', parentRepoPath: '' };
}

/**
 * Run `git init` silently when no `.git` exists in `cwd` or any parent.
 * SKIP init when one already exists (AC 12, AC 13).
 *
 * @param cwd absolute path to the project root
 * @returns `{initialized, alreadyExists, parentRepoPath}`
 */
export function initGit(cwd: string): InitGitResult {
  const probe = gitRevParseGitDir(cwd);
  if (probe.ok) {
    const cls = classifyGitDirOutput(cwd, probe.output);
    return {
      initialized: false,
      alreadyExists: cls.alreadyExists,
      parentRepoPath: cls.parentRepoPath,
    };
  }
  // Not inside a git repo — initialize silently. `execSync` with
  // `stdio: 'pipe'` suppresses git's "Initialized empty Git repository"
  // line; surfacing the message is the dashboard's job via the
  // init.complete SSE event.
  execSync('git init', { cwd, stdio: 'pipe' });
  return { initialized: true, alreadyExists: 'none', parentRepoPath: '' };
}

/**
 * Pure read-only sibling: classify the git state at `cwd` without ever
 * running `git init`. Used by `GET /api/init-precheck` (T03) so the wizard
 * can render the right Step 1 hint without mutating state.
 */
export function detectGitState(cwd: string): GitState {
  const probe = gitRevParseGitDir(cwd);
  if (!probe.ok) return 'absent';
  const cls = classifyGitDirOutput(cwd, probe.output);
  return cls.alreadyExists === 'cwd' ? 'repo' : 'parent_repo';
}
