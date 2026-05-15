/**
 * `initProject` — scaffolding gate semantics.
 *
 * The "already initialized" marker is `.swt-planning/PROJECT.md`, NOT the
 * `.swt-planning/` directory itself. The directory can legitimately
 * pre-exist from a pre-init action like a `POST /api/provider-auth` save
 * (the dashboard's config-write path does `mkdir -p .swt-planning/` so the
 * keychain auth block can land before the project is scaffolded). Init must
 * proceed in that case and fill in the missing scaffolding alongside the
 * pre-existing config.json — otherwise a user who authorizes a provider
 * before naming their project gets stuck on a blank screen.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AlreadyInitializedError, initProject } from '../../src/scaffold/init-project.js';

describe('initProject', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'swt-init-project-test-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('scaffolds PROJECT.md + STATE.md + phases/ on a fresh cwd', () => {
    const result = initProject({ cwd, name: 'my-project', source: 'cli' });

    expect(result.root).toBe(cwd);
    expect(existsSync(path.join(cwd, '.swt-planning', 'PROJECT.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'STATE.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'phases'))).toBe(true);
  });

  it('fills in PROJECT.md + STATE.md + phases/ alongside a pre-existing config.json (the bug fix)', () => {
    // Simulate the bug scenario: the user OAuth-authorized a provider via the
    // dashboard's "Provider ▾" menu before naming their project. That writes
    // `.swt-planning/config.json` (with the auth block) but no PROJECT.md.
    // Init must proceed, not throw.
    mkdirSync(path.join(cwd, '.swt-planning'), { recursive: true });
    const configJson = '{"auth":{"anthropic":{"mode":"oauth","credentialRef":"x"}}}\n';
    writeFileSync(path.join(cwd, '.swt-planning', 'config.json'), configJson, 'utf8');

    expect(() =>
      initProject({ cwd, name: 'my-project', description: 'desc', source: 'dashboard' }),
    ).not.toThrow();

    expect(existsSync(path.join(cwd, '.swt-planning', 'PROJECT.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'STATE.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'phases'))).toBe(true);
    // config.json from the pre-init provider-auth save is preserved untouched.
    expect(readFileSync(path.join(cwd, '.swt-planning', 'config.json'), 'utf8')).toBe(configJson);
  });

  it('throws AlreadyInitializedError when PROJECT.md already exists', () => {
    initProject({ cwd, name: 'first', source: 'cli' });

    expect(() => initProject({ cwd, name: 'second', source: 'cli' })).toThrow(
      AlreadyInitializedError,
    );
  });

  it('AlreadyInitializedError.message names PROJECT.md (not just the dir)', () => {
    initProject({ cwd, name: 'first', source: 'cli' });

    try {
      initProject({ cwd, name: 'second', source: 'cli' });
      throw new Error('expected AlreadyInitializedError');
    } catch (err) {
      expect(err).toBeInstanceOf(AlreadyInitializedError);
      expect((err as Error).message).toMatch(/PROJECT\.md/);
      expect((err as Error).message).toMatch(/already initialized/);
    }
  });
});
