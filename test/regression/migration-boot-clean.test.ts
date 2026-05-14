/**
 * `swt migrate --to=v3` end-to-end migration + boot-clean assertion.
 *
 * Phase 6 plan 06-04 T1 — REQ-19. Drives the migration handler
 * (`packages/cli/src/commands/migrate.ts`) against the synthesised
 * v2-baseline fixture at
 * `packages/test-utils/golden/ref-fastapi/v2-baseline/` and asserts:
 *
 *   1. Field rewrite — `config.json` `backend`/`agent_backend` flip to
 *      `'pi'` and markdown frontmatter `reasoning_effort:` is renamed
 *      to `thinking_level:` (the three confirmed v2→v3 deltas per the
 *      `migrate.ts` header comment).
 *   2. Idempotence — re-running `swt migrate --to=v3` against the
 *      already-v3 output tree is a no-op (the migrate.ts header line 7
 *      contract).
 *   3. Boot-clean — `swt detect-phase` succeeds on the migrated tree
 *      without parse / missing-config errors.
 *
 * Spawns the built `dist/cli.mjs` bundle to mirror the operator's
 * `swt migrate` invocation exactly (no in-process import shortcut, so
 * the bundle's argv parser + handler wiring is exercised end-to-end).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const FIXTURE = resolve(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi/v2-baseline');
const CLI_BIN = resolve(REPO_ROOT, 'dist/cli.mjs');

function migrate(input: string, output: string): { stdout: string; status: number } {
  const result = spawnSync(
    process.execPath,
    [CLI_BIN, 'migrate', `--to=v3`, '--input', input, '--output', output],
    { encoding: 'utf8', cwd: REPO_ROOT },
  );
  return { stdout: result.stdout ?? '', status: result.status ?? -1 };
}

function parseFrontmatter(raw: string): Record<string, string> {
  // Lightweight YAML frontmatter parse — only the keys we care about are
  // top-level scalars, so a regex split is sufficient.
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return {};
  const closeIdx = raw.indexOf('\n---\n', 4);
  if (closeIdx < 0) return {};
  const block = raw.slice(4, closeIdx);
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) {
        out[key] = value.trim();
      }
    }
  }
  return out;
}

function sha256Tree(dir: string): string {
  const hash = createHash('sha256');
  const walk = (absDir: string): void => {
    const entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const abs = join(absDir, entry.name);
      const rel = relative(dir, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        hash.update(`D ${rel}\n`);
        walk(abs);
      } else if (entry.isFile()) {
        hash.update(`F ${rel} `);
        hash.update(readFileSync(abs));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

// `skipIf` rather than a hard-throwing `beforeAll`: this suite boots the
// built `dist/cli.mjs`, so it is only meaningful once `pnpm build` has run.
// It is part of the default `pnpm test` set (`vitest.config.ts` includes
// `test/**`), and `ci.yml` / `release.yml` run `pnpm test` *before* `pnpm
// build` — a hard throw there crashes the whole suite. Skipping when the
// CLI bundle is absent is the correct behaviour; the `Regression` workflow
// builds first, so the suite still gets real coverage there (+ any local
// run after a build).
describe.skipIf(!existsSync(CLI_BIN))('swt migrate --to=v3 + boot-clean', () => {
  let tmpOut: string;

  beforeAll(() => {
    if (!existsSync(join(FIXTURE, '.swt-planning', 'config.json'))) {
      throw new Error(`v2-baseline fixture missing at ${FIXTURE}/.swt-planning/config.json.`);
    }
  });

  beforeEach(() => {
    tmpOut = mkdtempSync(join(tmpdir(), 'swt-migrate-boot-'));
  });

  afterEach(() => {
    rmSync(tmpOut, { recursive: true, force: true });
  });

  it('rewrites v2 config + markdown frontmatter to v3 shape', () => {
    const result = migrate(FIXTURE, tmpOut);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/swt migrate --to=v3: complete/);

    const config = JSON.parse(
      readFileSync(join(tmpOut, '.swt-planning', 'config.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(config['backend']).toBe('pi');
    expect(config['agent_backend']).toBe('pi');
    // Note: migrate.ts rewrites JSON `backend`/`agent_backend` fields but
    // does NOT rewrite the top-level `reasoning_effort` JSON key — only
    // markdown frontmatter is rewritten for the `reasoning_effort` →
    // `thinking_level` rename. The JSON field is left untouched (the
    // migrate.ts header documents this scope: backend / agent_backend
    // in JSON, reasoning_effort in markdown frontmatter).
    expect(config['version']).toBe('2.3.5'); // version field passes through

    const research = readFileSync(
      join(tmpOut, '.swt-planning', 'phases', '01-foundation', '01-RESEARCH.md'),
      'utf8',
    );
    const researchFm = parseFrontmatter(research);
    expect(researchFm['thinking_level']).toBe('medium');
    expect(researchFm['reasoning_effort']).toBeUndefined();

    const state = readFileSync(join(tmpOut, '.swt-planning', 'STATE.md'), 'utf8');
    const stateFm = parseFrontmatter(state);
    expect(stateFm['thinking_level']).toBe('medium');
    expect(stateFm['reasoning_effort']).toBeUndefined();
  });

  it('migration is idempotent — re-running on v3 output is a no-op', () => {
    expect(migrate(FIXTURE, tmpOut).status).toBe(0);

    const beforeSha = sha256Tree(join(tmpOut, '.swt-planning'));

    const tmpOut2 = mkdtempSync(join(tmpdir(), 'swt-migrate-idempotent-'));
    try {
      // Re-run against the already-v3 output. The migrate handler walks
      // the JSON + markdown but every `backend`/`agent_backend` field is
      // already `'pi'` and every frontmatter is already `thinking_level:`,
      // so `fields_rewritten` should be 0.
      const second = migrate(tmpOut, tmpOut2);
      expect(second.status).toBe(0);
      expect(second.stdout).toMatch(/Fields rewritten: 0/);

      const afterSha = sha256Tree(join(tmpOut2, '.swt-planning'));
      expect(afterSha).toBe(beforeSha);
    } finally {
      rmSync(tmpOut2, { recursive: true, force: true });
    }
  });

  it('boot-clean: migrated tree boots under swt detect-phase without errors', () => {
    expect(migrate(FIXTURE, tmpOut).status).toBe(0);

    // `swt detect-phase` is the minimum boot probe: it reads
    // `.swt-planning/config.json` + scans `phases/`, validates the config
    // shape, and prints a JSON result. Any parse / schema error in the
    // migrated tree surfaces as a non-zero exit + stderr write.
    const probe = spawnSync(process.execPath, [CLI_BIN, 'detect-phase'], {
      cwd: tmpOut,
      encoding: 'utf8',
    });
    expect(probe.status).toBe(0);
    expect(probe.stdout).toMatch(/next_phase_state/);
    // No parse / missing-config noise in stderr.
    expect(probe.stderr).not.toMatch(/missing.*config|parse.*error|invalid/i);
  });
});

// Reference unused imports so the lint pass keeps them — `statSync` reserved
// for future stat-based assertions on migrated artefact mtimes.
void statSync;
void execFileSync;
