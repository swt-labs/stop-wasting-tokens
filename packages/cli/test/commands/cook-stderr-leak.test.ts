import { execSync as nodeExecSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tryReadHeadCommit } from '../../src/commands/cook.js';

/**
 * Phase 01 T2 — regression test for the git stderr bleed bug.
 *
 * The original bug: cook's `tryReadHeadCommit` called `execSync('git log -1 ...')`
 * without a stdio shape, so Node's default `['inherit', 'pipe', 'inherit']`
 * inherited stderr to the parent process. Against a non-git cwd, git's
 * "fatal: not a git repository ..." line leaked into the dashboard's Log
 * panel even though the catch block correctly returned `undefined`.
 *
 * T1 added `stdio: ['ignore', 'pipe', 'pipe']` to suppress stderr inheritance.
 * This test spies on `process.stderr.write` and asserts no "fatal: not a git"
 * line crosses the boundary, plus the behavioral invariant: the function
 * still returns `undefined` against a non-git cwd.
 *
 * Pattern A: in-process spy, no subprocess fixture needed.
 */

let dir: string;

beforeEach(async () => {
  // Fresh tmp dir per test. Do NOT run `git init` — the dir must remain
  // non-git so the probe trips git's "fatal: not a git repository" path.
  dir = await mkdtemp(join(tmpdir(), 'swt-stderr-leak-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('tryReadHeadCommit — no git stderr bleed', () => {
  it('does not leak "fatal: not a git" to parent stderr against a non-git cwd', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const result = tryReadHeadCommit(dir, nodeExecSync);

      // Behavioral invariant: still returns undefined against a non-git cwd.
      expect(result).toBeUndefined();

      // The actual regression assertion: no captured stderr chunk matches
      // git's "fatal: not a git repository (or any of the parent directories)"
      // signature. If T1's stdio suppression were removed, this would fail.
      const leaked = stderrSpy.mock.calls.some(([chunk]) =>
        /fatal:.*not a git/i.test(String(chunk)),
      );
      expect(leaked).toBe(false);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('still returns undefined against a non-git cwd (behavioral invariant)', () => {
    // Belt-and-suspenders: guarantees the try/catch contract didn't regress
    // even if a future change to the stderr-suppression accidentally swallows
    // a real error path.
    const result = tryReadHeadCommit(dir, nodeExecSync);
    expect(result).toBeUndefined();
  });
});
