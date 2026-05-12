/**
 * Cross-OS path-discipline unit tests for `lock-files.ts` per ADR-009 +
 * Plan 03-04 PR-30.
 *
 * Lock files are JSON envelopes pretty-printed via `JSON.stringify(env,
 * null, 2)`. JSON.stringify uses `\n` as its line separator by spec
 * regardless of host EOL (`os.EOL` is `\r\n` on Windows, but JSON
 * indentation is platform-independent). These tests pin that
 * invariant — a future refactor that switches to `os.EOL` would break
 * the cassette-format byte-hashing + reproducible-build (ADR-010)
 * promises.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { acquireLock, lockPathFor } from '../src/lock-files.js';

interface Fixture {
  readonly root: string;
  readonly locksRoot: string;
}

function setupFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-lock-win-'));
  const locksRoot = path.posix.join(root.split(path.sep).join('/'), 'locks');
  mkdirSync(locksRoot, { recursive: true });
  return { root, locksRoot };
}

describe('lock-files — Windows path discipline (ADR-009)', () => {
  it('lock file body contains LF (\\n) only — no CRLF regardless of host', async () => {
    const fixture = setupFixture();
    try {
      const handle = await acquireLock({
        locksRoot: fixture.locksRoot,
        taskId: 'T-LOCK-WIN-01',
        worktreePath: 'parallel/wt-T-LOCK-WIN-01/',
        state: 'created',
        pidChecker: () => 'alive',
      });
      const raw = readFileSync(handle.path, 'utf8');
      // No CRLF anywhere in the envelope.
      expect(raw).not.toMatch(/\r\n/);
      // JSON.stringify with indent uses `\n` separators by spec.
      expect(raw).toContain('\n');
      // Round-trip parses cleanly.
      expect(() => JSON.parse(raw)).not.toThrow();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('updated lock file also uses LF (handle.update preserves \\n)', async () => {
    const fixture = setupFixture();
    try {
      const handle = await acquireLock({
        locksRoot: fixture.locksRoot,
        taskId: 'T-LOCK-WIN-02',
        worktreePath: 'parallel/wt-T-LOCK-WIN-02/',
        state: 'created',
        pidChecker: () => 'alive',
      });
      await handle.update({ state: 'dispatched' });
      const raw = readFileSync(handle.path, 'utf8');
      expect(raw).not.toMatch(/\r\n/);
      const parsed = JSON.parse(raw) as { state: string };
      expect(parsed.state).toBe('dispatched');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('lockPathFor produces POSIX-style paths (forward slash, no backslash)', () => {
    const fixture = setupFixture();
    try {
      const p = lockPathFor(fixture.locksRoot, 'T-LOCK-WIN-03');
      expect(p).not.toMatch(/\\/);
      expect(p).toContain('/');
      expect(p.endsWith('task-T-LOCK-WIN-03.lock')).toBe(true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
