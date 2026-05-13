/**
 * Phase G / Phase 1 / Plan 01-01 T1 — `readProviderOverlay` unit tests.
 *
 * Coverage:
 *   1. File present, no frontmatter — returns trimmed body verbatim.
 *   2. File present, with YAML frontmatter — frontmatter is stripped.
 *   3. File absent — returns `undefined` (MUST NOT throw on ENOENT).
 *   4. `provider` undefined — returns `undefined` even if file exists.
 *   5. `provider` empty string — returns `undefined` (overlay-disabled).
 *   6. Different role keys resolve different files.
 *   7. Determinism — repeated calls return byte-identical strings.
 *   8. No throw on non-existent installRoot directory.
 *
 * Fixtures live in per-test `mkdtempSync` directories; no real
 * `provider_overlays/` files are required for the test to pass.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, test } from 'vitest';

import { readProviderOverlay } from '../src/index.js';

function makeTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'swt-overlay-'));
}

function writeOverlay(root: string, role: string, provider: string, body: string): string {
  const dir = resolve(root, 'provider_overlays');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${role}-${provider}.md`);
  writeFileSync(path, body, 'utf8');
  return path;
}

describe('@swt-labs/orchestration — readProviderOverlay (Plan 01-01 T1)', () => {
  it('1. file present, no frontmatter — returns trimmed body verbatim', () => {
    const root = makeTmpRoot();
    writeOverlay(root, 'dev', 'openai', 'hello overlay');
    expect(readProviderOverlay(root, 'dev', 'openai')).toBe('hello overlay');
  });

  it('2. file present, with YAML frontmatter — frontmatter is stripped', () => {
    const root = makeTmpRoot();
    const fileBody = '---\noverlay_for: dev\nprovider: openai\n---\nbody-text';
    writeOverlay(root, 'dev', 'openai', fileBody);
    expect(readProviderOverlay(root, 'dev', 'openai')).toBe('body-text');
  });

  it('2b. multi-line YAML frontmatter is stripped and only the body remains', () => {
    const root = makeTmpRoot();
    const fileBody = [
      '---',
      'overlay_for: dev',
      'provider: openai',
      'model_families: [gpt-5, o3-pro]',
      'version: 1',
      '---',
      'line one',
      'line two',
      '',
    ].join('\n');
    writeOverlay(root, 'dev', 'openai', fileBody);
    expect(readProviderOverlay(root, 'dev', 'openai')).toBe('line one\nline two');
  });

  it('3. file absent — returns undefined (no throw on ENOENT)', () => {
    const root = makeTmpRoot();
    // No file written. Resolver must not throw.
    expect(readProviderOverlay(root, 'dev', 'openai')).toBeUndefined();
  });

  it('4. provider undefined — returns undefined even if file exists', () => {
    const root = makeTmpRoot();
    writeOverlay(root, 'dev', 'openai', 'body');
    expect(readProviderOverlay(root, 'dev', undefined)).toBeUndefined();
  });

  it('5. provider empty string — returns undefined (overlay-disabled fast path)', () => {
    const root = makeTmpRoot();
    writeOverlay(root, 'dev', 'openai', 'body');
    expect(readProviderOverlay(root, 'dev', '')).toBeUndefined();
  });

  it('6. different role keys resolve different files', () => {
    const root = makeTmpRoot();
    writeOverlay(root, 'dev', 'openai', 'dev-body');
    writeOverlay(root, 'qa', 'openai', 'qa-body');
    expect(readProviderOverlay(root, 'dev', 'openai')).toBe('dev-body');
    expect(readProviderOverlay(root, 'qa', 'openai')).toBe('qa-body');
  });

  it('7. determinism — 10 repeated calls return byte-identical strings', () => {
    const root = makeTmpRoot();
    writeOverlay(root, 'dev', 'openai', '---\nv: 1\n---\nbody-deterministic');
    const first = readProviderOverlay(root, 'dev', 'openai');
    for (let i = 0; i < 10; i++) {
      expect(readProviderOverlay(root, 'dev', 'openai')).toBe(first);
    }
  });

  it('8. no throw when installRoot directory does not exist', () => {
    const nonexistent = resolve(tmpdir(), 'swt-overlay-does-not-exist-12345');
    expect(() => readProviderOverlay(nonexistent, 'dev', 'openai')).not.toThrow();
    expect(readProviderOverlay(nonexistent, 'dev', 'openai')).toBeUndefined();
  });

  it('frontmatter-stripping is a no-op when the opener is missing', () => {
    // Trailing `---` is NOT a frontmatter; only a leading `---\n` triggers
    // stripping. Body is returned verbatim (trimmed).
    const root = makeTmpRoot();
    writeOverlay(root, 'dev', 'openai', 'body\n---\nnot-frontmatter');
    expect(readProviderOverlay(root, 'dev', 'openai')).toBe('body\n---\nnot-frontmatter');
  });

  it('frontmatter-stripping is a no-op when the closer is missing', () => {
    // Opener present, closer absent → entire body (including opener) is
    // returned unchanged after trim.
    const root = makeTmpRoot();
    writeOverlay(root, 'dev', 'openai', '---\nno-closer-here\nbody');
    expect(readProviderOverlay(root, 'dev', 'openai')).toBe('---\nno-closer-here\nbody');
  });
});

/**
 * Phase 1 / Plan 01-03 T4 — end-to-end resolution of the 3 actual on-disk overlays.
 *
 * Reads `provider_overlays/{dev,debugger,qa}-openai.md` from the real repo
 * (NOT a tmpdir fixture) and asserts the resolver contract holds end-to-end:
 *   - non-empty body returned
 *   - YAML frontmatter stripped (body does NOT begin with `---`)
 *   - intent-mirror header comment is present (authoring discipline landed)
 *   - body references SWT-native tools (no vendor-tool leaks)
 *   - frontmatter on disk has the required schema fields
 *
 * This is the only Phase 1 verification of the wiring against real overlay
 * files. Future quality-measurement plans extend this further.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirnameLocal = dirname(__filename);
// Test file lives at packages/orchestration/test/; repo root is 3 levels up.
const repoRoot = resolve(__dirnameLocal, '..', '..', '..');

describe('Phase 1 OpenAI overlays — actual on-disk files (Plan 01-03 T4)', () => {
  test.each([
    ['dev', 'dev-openai.md'],
    ['debugger', 'debugger-openai.md'],
    ['qa', 'qa-openai.md'],
  ])('%s overlay resolves end-to-end', (role, _filename) => {
    const body = readProviderOverlay(repoRoot, role, 'openai');
    expect(body).toBeDefined();
    expect(body).not.toBe('');
    // Frontmatter must be stripped — body should NOT start with `---`.
    expect(body!.startsWith('---')).toBe(false);
    // Intent-mirror header comment is present.
    expect(body).toMatch(/Intent-mirror of OpenAI Codex CLI/);
    expect(body).toMatch(/DO NOT copy verbatim/);
    // Body references SWT-native tools (sanity check the discipline rule).
    expect(body).toMatch(/Edit|Bash|Read|Grep|LSP/);
  });

  test('all three overlays have valid frontmatter on disk', () => {
    const roles = ['dev', 'debugger', 'qa'];
    for (const role of roles) {
      const filePath = resolve(repoRoot, 'provider_overlays', `${role}-openai.md`);
      const raw = readFileSync(filePath, 'utf8');
      expect(raw.startsWith('---\n')).toBe(true);
      expect(raw).toMatch(new RegExp(`overlay_for:\\s*${role}`));
      expect(raw).toMatch(/provider:\s*openai/);
      expect(raw).toMatch(/schema_version:\s*1/);
    }
  });
});
