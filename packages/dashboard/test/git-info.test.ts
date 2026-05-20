/**
 * Statusline v2 Wave 5 commit 9 — coverage for the server-side git
 * detection module and the client-side branch formatter.
 *
 * `parseRepoPath` and `formatStatuslineBranch` are pure helpers — node-env
 * unit tests. `detectGitInfo` is exercised against a real temp git
 * repository so the `.git/HEAD` parsing + `git rev-parse` shell-out
 * branches are both covered.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectGitInfo, parseRepoPath } from '../src/server/snapshot/git-info.js';
import { formatStatuslineBranch } from '../src/client/components/statusline-helpers.js';

describe('parseRepoPath', () => {
  it('parses canonical HTTPS GitHub URLs', () => {
    expect(parseRepoPath('https://github.com/swt-labs/stop-wasting-tokens')).toBe(
      'swt-labs/stop-wasting-tokens',
    );
    expect(parseRepoPath('https://github.com/anthropics/claude-code')).toBe(
      'anthropics/claude-code',
    );
  });

  it('strips the .git suffix from HTTPS URLs', () => {
    expect(parseRepoPath('https://github.com/swt-labs/stop-wasting-tokens.git')).toBe(
      'swt-labs/stop-wasting-tokens',
    );
  });

  it('parses canonical SSH GitHub URLs', () => {
    expect(parseRepoPath('git@github.com:swt-labs/stop-wasting-tokens')).toBe(
      'swt-labs/stop-wasting-tokens',
    );
  });

  it('strips the .git suffix from SSH URLs', () => {
    expect(parseRepoPath('git@github.com:swt-labs/stop-wasting-tokens.git')).toBe(
      'swt-labs/stop-wasting-tokens',
    );
  });

  it('returns null for non-GitHub origins', () => {
    expect(parseRepoPath('https://gitlab.com/foo/bar')).toBeNull();
    expect(parseRepoPath('git@bitbucket.org:foo/bar.git')).toBeNull();
    expect(parseRepoPath('https://example.com/whatever')).toBeNull();
  });

  it('returns null for empty / malformed inputs', () => {
    expect(parseRepoPath('')).toBeNull();
    expect(parseRepoPath('not a url')).toBeNull();
    expect(parseRepoPath('github.com/foo/bar')).toBeNull(); // missing scheme prefix
  });
});

describe('formatStatuslineBranch', () => {
  it('returns the branch name verbatim for a normal checkout', () => {
    expect(formatStatuslineBranch('main', false, 'bc604ed')).toBe('main');
    expect(formatStatuslineBranch('feature/v2-statusline', false, 'abc1234')).toBe(
      'feature/v2-statusline',
    );
  });

  it('returns `detached@<short_sha>` for a detached HEAD', () => {
    expect(formatStatuslineBranch(null, true, 'bc604ed')).toBe('detached@bc604ed');
  });

  it('returns em-dash for a defensive empty input', () => {
    // Unreachable in production (the caller hides the Project group
    // when git is undefined) but the helper handles the empty input
    // defensively.
    expect(formatStatuslineBranch(null, false, '')).toBe('—');
    expect(formatStatuslineBranch('', false, '')).toBe('—');
  });
});

describe('detectGitInfo', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'swt-git-info-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, {
      cwd,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  }

  it('returns undefined for a non-git workspace', () => {
    expect(detectGitInfo(tmpDir)).toBeUndefined();
  });

  it('returns branch + short SHA for a fresh repo on the default branch', () => {
    git(tmpDir, 'init', '-b', 'main', '-q');
    writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
    git(tmpDir, 'add', 'README.md');
    git(tmpDir, 'commit', '-m', 'initial', '-q');

    const info = detectGitInfo(tmpDir);
    expect(info).toBeDefined();
    expect(info?.branch).toBe('main');
    expect(info?.detached).toBe(false);
    expect(info?.repo_basename).toBe(path.basename(tmpDir));
    expect(info?.repo_url_path).toBeNull(); // no remote configured
    expect(info?.short_sha).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it('returns repo_url_path when origin is a GitHub URL', () => {
    git(tmpDir, 'init', '-b', 'main', '-q');
    writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
    git(tmpDir, 'add', 'README.md');
    git(tmpDir, 'commit', '-m', 'initial', '-q');
    git(
      tmpDir,
      'remote',
      'add',
      'origin',
      'https://github.com/swt-labs/stop-wasting-tokens.git',
    );

    const info = detectGitInfo(tmpDir);
    expect(info?.repo_url_path).toBe('swt-labs/stop-wasting-tokens');
  });

  it('returns null repo_url_path for non-GitHub origins', () => {
    git(tmpDir, 'init', '-b', 'main', '-q');
    writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
    git(tmpDir, 'add', 'README.md');
    git(tmpDir, 'commit', '-m', 'initial', '-q');
    git(tmpDir, 'remote', 'add', 'origin', 'https://gitlab.com/foo/bar.git');

    const info = detectGitInfo(tmpDir);
    expect(info?.repo_url_path).toBeNull();
  });

  it('recognises detached HEAD', () => {
    git(tmpDir, 'init', '-b', 'main', '-q');
    writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
    git(tmpDir, 'add', 'README.md');
    git(tmpDir, 'commit', '-m', 'first', '-q');
    writeFileSync(path.join(tmpDir, 'README.md'), '# updated\n');
    git(tmpDir, 'add', 'README.md');
    git(tmpDir, 'commit', '-m', 'second', '-q');
    // Detach onto the first commit.
    execFileSync('git', ['checkout', '--detach', 'HEAD~1'], {
      cwd: tmpDir,
      stdio: 'ignore',
    });

    const info = detectGitInfo(tmpDir);
    expect(info?.detached).toBe(true);
    expect(info?.branch).toBeNull();
    expect(info?.short_sha).toMatch(/^[0-9a-f]{7,40}$/);
  });
});
