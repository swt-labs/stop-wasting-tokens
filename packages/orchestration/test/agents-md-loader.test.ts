/**
 * `agents-md-loader.test.ts` — Phase 17 plan 03-01 Task 1.
 *
 * Fixture-based unit tests for `loadAgentsMd` per Scout §A.1 + §C.4. Each
 * test mints an isolated temp dir via `mkdtempSync(tmpdir, 'swt-agents-md-')`
 * and tears it down in `afterEach` (`rmSync({recursive, force})`). Real
 * `node:fs` — no mock filesystem.
 *
 * Coverage matrix:
 *   1. Walk-up: 4-level chain (root → a → a/b → a/b/c) concatenates in
 *      root-first order.
 *   2. Override REPLACE semantics: AGENTS.override.md preempts AGENTS.md
 *      at the same level, both for override-only and both-present cases.
 *   3. Silent missing-file: nothing thrown, no console.warn output.
 *   4. No-.git-ancestor: walks back to filesystem root, returns []
 *      (no marker → cwd-only fallback per Scout §A.1 step 3 — but in
 *      this test, cwd ALSO has no AGENTS.md, so result is []).
 *   5. Empty walk: .git present but zero AGENTS.md files anywhere → [].
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAgentsMd } from '../src/context/agents-md-loader.js';

describe('loadAgentsMd', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'swt-agents-md-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('walks from .git-ancestor root down to cwd and concatenates in root-first order', () => {
    // Layout:
    //   <projectRoot>/.git/                       (marker)
    //   <projectRoot>/AGENTS.md                   = "root-rule"
    //   <projectRoot>/a/AGENTS.md                 = "a-rule"
    //   <projectRoot>/a/b/AGENTS.md               = "b-rule"
    //   <projectRoot>/a/b/c/AGENTS.md             = "leaf-rule"
    mkdirSync(join(projectRoot, '.git'));
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'root-rule\n', 'utf8');

    const a = join(projectRoot, 'a');
    const b = join(a, 'b');
    const c = join(b, 'c');
    mkdirSync(a);
    writeFileSync(join(a, 'AGENTS.md'), 'a-rule\n', 'utf8');
    mkdirSync(b);
    writeFileSync(join(b, 'AGENTS.md'), 'b-rule\n', 'utf8');
    mkdirSync(c);
    writeFileSync(join(c, 'AGENTS.md'), 'leaf-rule\n', 'utf8');

    const result = loadAgentsMd({ cwd: c });

    expect(result).toHaveLength(4);
    expect(result[0]).toBe('root-rule\n');
    expect(result[1]).toBe('a-rule\n');
    expect(result[2]).toBe('b-rule\n');
    expect(result[3]).toBe('leaf-rule\n');
  });

  it('AGENTS.override.md REPLACES AGENTS.md at the same directory level', () => {
    // Test the both-present case AND the override-only case in one fixture:
    //   <projectRoot>/.git/                                       (marker)
    //   <projectRoot>/AGENTS.md                = "root-base"      (no override at root)
    //   <projectRoot>/middle/AGENTS.md          = "middle-base"   (BOTH present
    //   <projectRoot>/middle/AGENTS.override.md = "middle-OVR"     at middle → override wins)
    //   <projectRoot>/middle/leaf/AGENTS.override.md = "leaf-OVR" (override-only at leaf)
    mkdirSync(join(projectRoot, '.git'));
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'root-base', 'utf8');

    const middle = join(projectRoot, 'middle');
    const leaf = join(middle, 'leaf');
    mkdirSync(middle);
    writeFileSync(join(middle, 'AGENTS.md'), 'middle-base', 'utf8');
    writeFileSync(join(middle, 'AGENTS.override.md'), 'middle-OVR', 'utf8');
    mkdirSync(leaf);
    writeFileSync(join(leaf, 'AGENTS.override.md'), 'leaf-OVR', 'utf8');

    const result = loadAgentsMd({ cwd: leaf });

    // root contributes AGENTS.md (no override exists there);
    // middle contributes the override (AGENTS.md SHOULD NOT appear);
    // leaf contributes the override (AGENTS.md absent anyway).
    expect(result).toEqual(['root-base', 'middle-OVR', 'leaf-OVR']);
    expect(result).not.toContain('middle-base');
  });

  it('silently skips levels with no AGENTS.md files; no throw, no warn', () => {
    // Layout: only .git marker, AGENTS.md only at the leaf — intermediate
    // levels contribute nothing.
    //   <projectRoot>/.git/
    //   <projectRoot>/a/b/AGENTS.md = "only-leaf"
    mkdirSync(join(projectRoot, '.git'));
    const a = join(projectRoot, 'a');
    const b = join(a, 'b');
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(b, 'AGENTS.md'), 'only-leaf', 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = loadAgentsMd({ cwd: b });

    expect(result).toEqual(['only-leaf']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('no-.git-ancestor falls back to cwd-only resolution', () => {
    // Layout: no .git anywhere in the chain. Loader hits filesystem root
    // without finding a marker → cwd-only fallback (returns [] in this
    // test because the temp dir has no AGENTS.md either).
    //
    // We also create AGENTS.md AT the temp-cwd to prove the loader does
    // examine cwd even when no .git exists.
    //
    // NOTE: macOS `mkdtemp` returns a path inside `/var/folders/...`. The
    // walk from there to `/` will not encounter any .git marker (assuming
    // no test runner mutates /tmp/.git), satisfying the fallback path.
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'cwd-only-rule', 'utf8');

    const result = loadAgentsMd({ cwd: projectRoot });

    // Cwd-only fallback means we check projectRoot itself; AGENTS.md is
    // present there.
    expect(result).toEqual(['cwd-only-rule']);
  });

  it('returns empty when .git exists but no AGENTS.md files anywhere in walk path', () => {
    // Layout: only .git marker — no AGENTS.md / AGENTS.override.md
    // anywhere on the walk.
    mkdirSync(join(projectRoot, '.git'));
    const sub = join(projectRoot, 'sub');
    mkdirSync(sub);

    const result = loadAgentsMd({ cwd: sub });

    expect(result).toEqual([]);
  });
});
