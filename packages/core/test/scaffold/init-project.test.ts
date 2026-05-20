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
 *
 * Milestone 23 Phase 01 T01 — initProject now writes 4 new artifacts in
 * addition to PROJECT.md + STATE.md + phases/: REQUIREMENTS.md (from
 * templates/), ROADMAP.md (from templates/), and config.json (deep-merged
 * from config/defaults.json with planning_tracking + auto_push overrides).
 *
 * Milestone 23 Phase 01 T02 — initProject now also orchestrates
 * detectBrownfield → initGit → writeConfigJson → syncGitignore →
 * runDetectStack (brownfield only) → bootstrapClaudeMd → installGitHooks.
 * The 4 new E2E tests below exercise greenfield, brownfield, parent-repo,
 * and cwd-repo branches (AC 12, AC 13, AC 14, AC 15, AC 16, AC 17).
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AlreadyInitializedError, initProject } from '../../src/scaffold/init-project.js';

// The plugin root is the SWT install dir containing templates/ + config/.
// Walk up from this test file (packages/core/test/scaffold/init-project.test.ts)
// to the workspace root.
const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

describe('initProject', () => {
  let cwd: string;

  beforeEach(() => {
    // realpathSync resolves /var/folders/... → /private/var/folders/... on
    // macOS so `git rev-parse --show-toplevel` (which always returns the
    // real path) compares equal to `cwd` for the cwd-repo branch.
    cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'swt-init-project-test-')));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('scaffolds PROJECT.md + STATE.md + phases/ on a fresh cwd', () => {
    const result = initProject({
      cwd,
      name: 'my-project',
      description: 'A test project.',
      source: 'cli',
      pluginRoot,
    });

    expect(result.root).toBe(cwd);
    expect(existsSync(path.join(cwd, '.swt-planning', 'PROJECT.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'STATE.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'phases'))).toBe(true);
  });

  it('fills in PROJECT.md + STATE.md + phases/ alongside a pre-existing config.json (the bug fix)', () => {
    // Simulate the bug scenario: the user OAuth-authorized a provider via the
    // dashboard's "Provider ▾" menu before naming their project. That writes
    // `.swt-planning/config.json` (with the auth block) but no PROJECT.md.
    // Init must proceed, not throw. T01 update: the config.json now deep-merges
    // so the auth keys survive the rewrite.
    mkdirSync(path.join(cwd, '.swt-planning'), { recursive: true });
    const configJson = '{"auth":{"anthropic":{"mode":"oauth","credentialRef":"x"}}}\n';
    writeFileSync(path.join(cwd, '.swt-planning', 'config.json'), configJson, 'utf8');

    expect(() =>
      initProject({
        cwd,
        name: 'my-project',
        description: 'desc',
        source: 'dashboard',
        pluginRoot,
      }),
    ).not.toThrow();

    expect(existsSync(path.join(cwd, '.swt-planning', 'PROJECT.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'STATE.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'phases'))).toBe(true);

    // config.json from the pre-init provider-auth save is preserved — the
    // `auth` block carried by the pre-existing config survives the deep-merge.
    const merged = JSON.parse(
      readFileSync(path.join(cwd, '.swt-planning', 'config.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(merged.auth).toEqual({ anthropic: { mode: 'oauth', credentialRef: 'x' } });
    // Defaults are also present (deep-merge layered defaults underneath).
    expect(merged.effort).toBe('balanced');
    expect(merged.planning_tracking).toBe('manual');
  });

  it('throws AlreadyInitializedError when PROJECT.md already exists', () => {
    initProject({
      cwd,
      name: 'first',
      description: 'desc',
      source: 'cli',
      pluginRoot,
    });

    expect(() =>
      initProject({ cwd, name: 'second', description: 'desc', source: 'cli', pluginRoot }),
    ).toThrow(AlreadyInitializedError);
  });

  it('AlreadyInitializedError.message names PROJECT.md (not just the dir)', () => {
    initProject({
      cwd,
      name: 'first',
      description: 'desc',
      source: 'cli',
      pluginRoot,
    });

    try {
      initProject({ cwd, name: 'second', description: 'desc', source: 'cli', pluginRoot });
      throw new Error('expected AlreadyInitializedError');
    } catch (err) {
      expect(err).toBeInstanceOf(AlreadyInitializedError);
      expect((err as Error).message).toMatch(/PROJECT\.md/);
      expect((err as Error).message).toMatch(/already initialized/);
    }
  });

  // ── Milestone 23 Phase 01 T01 — AC 10, AC 11 ──────────────────────────

  it('AC 10 — writes all 5 planning files + phases/ (PROJECT, STATE, REQUIREMENTS, ROADMAP, config.json)', () => {
    const result = initProject({
      cwd,
      name: 'my-project',
      description: 'A test project.',
      source: 'dashboard',
      pluginRoot,
    });

    expect(existsSync(path.join(cwd, '.swt-planning', 'PROJECT.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'STATE.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'REQUIREMENTS.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'ROADMAP.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'config.json'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'phases'))).toBe(true);

    // result.files lists 5 files + 1 dir (relative paths).
    expect(result.files).toHaveLength(6);
    expect(result.files).toContain(path.join('.swt-planning', 'PROJECT.md'));
    expect(result.files).toContain(path.join('.swt-planning', 'STATE.md'));
    expect(result.files).toContain(path.join('.swt-planning', 'REQUIREMENTS.md'));
    expect(result.files).toContain(path.join('.swt-planning', 'ROADMAP.md'));
    expect(result.files).toContain(path.join('.swt-planning', 'config.json'));
    expect(result.files).toContain(path.join('.swt-planning', 'phases'));

    // T02 wired the real values: greenfield + no parent repo →
    // gitInitialized true, brownfield false, stack [].
    expect(result.brownfield).toBe(false);
    expect(result.gitInitialized).toBe(true);
    expect(result.stack).toEqual([]);
  });

  it('AC 11 — config.json deep-merges defaults.json with planning_tracking + auto_push overrides', () => {
    initProject({
      cwd,
      name: 'config-test',
      description: 'desc',
      planningTracking: 'commit',
      autoPush: 'after_phase',
      source: 'dashboard',
      pluginRoot,
    });

    const merged = JSON.parse(
      readFileSync(path.join(cwd, '.swt-planning', 'config.json'), 'utf8'),
    ) as Record<string, unknown>;

    // Overrides applied at the correct keys.
    expect(merged.planning_tracking).toBe('commit');
    expect(merged.auto_push).toBe('after_phase');
    // Defaults are still present for keys NOT overridden.
    expect(merged.effort).toBe('balanced');
    expect(merged.autonomy).toBe('standard');
    expect(merged.model_profile).toBe('quality');
    expect(merged.active_profile).toBe('default');
  });

  it('config.json preserves defaults when planning_tracking + auto_push are omitted', () => {
    initProject({
      cwd,
      name: 'defaults-test',
      description: 'desc',
      source: 'cli',
      pluginRoot,
    });

    const merged = JSON.parse(
      readFileSync(path.join(cwd, '.swt-planning', 'config.json'), 'utf8'),
    ) as Record<string, unknown>;

    // Defaults preserved when no overrides.
    expect(merged.planning_tracking).toBe('manual');
    expect(merged.auto_push).toBe('never');
  });

  it('REQUIREMENTS.md + ROADMAP.md substitute project name + description tokens', () => {
    initProject({
      cwd,
      name: 'AwesomeProj',
      description: 'A tool that does X.',
      source: 'dashboard',
      pluginRoot,
    });

    const requirements = readFileSync(path.join(cwd, '.swt-planning', 'REQUIREMENTS.md'), 'utf8');
    expect(requirements).toContain('AwesomeProj');
    expect(requirements).toContain('A tool that does X.');
    // The `{Project Name}` and `{one-liner}` tokens are substituted out.
    expect(requirements).not.toContain('{Project Name}');
    expect(requirements).not.toContain('{one-liner}');

    const roadmap = readFileSync(path.join(cwd, '.swt-planning', 'ROADMAP.md'), 'utf8');
    expect(roadmap).toContain('AwesomeProj');
    expect(roadmap).toContain('A tool that does X.');
    expect(roadmap).not.toContain('{Project Name}');
    expect(roadmap).not.toContain('{overview-sentence}');
  });

  // ── Milestone 23 Phase 01 T02 — AC 12, AC 13, AC 14, AC 15, AC 16, AC 17 ──

  it('AC 12 + AC 14 + AC 15 + AC 17 — greenfield E2E: writes 6 planning files, runs git init, syncs .gitignore, installs hooks, bootstraps CLAUDE.md', () => {
    const result = initProject({
      cwd,
      name: 'greenfield-e2e',
      description: 'A fresh greenfield project.',
      source: 'cli',
      pluginRoot,
    });

    // All 6 planning files present.
    expect(existsSync(path.join(cwd, '.swt-planning', 'PROJECT.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'STATE.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'REQUIREMENTS.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'ROADMAP.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'config.json'))).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'phases'))).toBe(true);

    // .git/ created (AC 12).
    expect(existsSync(path.join(cwd, '.git'))).toBe(true);
    expect(result.gitInitialized).toBe(true);

    // CLAUDE.md created (AC 17).
    expect(existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(true);

    // .gitignore synced (AC 14) — planning-git.sh sync-ignore writes the
    // transient .swt-planning/.gitignore unconditionally; the root
    // .gitignore is only touched in `ignore` / `commit` planning modes
    // (greenfield + default `manual` doesn't write a root .gitignore).
    expect(existsSync(path.join(cwd, '.swt-planning', '.gitignore'))).toBe(true);

    // pre-push hook installed (AC 15).
    expect(existsSync(path.join(cwd, '.git', 'hooks', 'pre-push'))).toBe(true);

    // Greenfield: no source files, stack empty (AC 16).
    expect(result.brownfield).toBe(false);
    expect(result.stack).toEqual([]);
  });

  it('AC 16 — brownfield E2E: detect-stack.sh runs and stack.json is populated', () => {
    // Drop a package.json + tsconfig.json + src/index.ts so detectBrownfield
    // trips AND detect-stack.sh classifies the project as typescript (the
    // stack-mappings.json typescript pattern matches on tsconfig.json
    // presence, not on .ts files).
    writeFileSync(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'brownfield-fixture', version: '0.0.0' }, null, 2),
      'utf8',
    );
    writeFileSync(
      path.join(cwd, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022' } }, null, 2),
      'utf8',
    );
    mkdirSync(path.join(cwd, 'src'), { recursive: true });
    writeFileSync(path.join(cwd, 'src', 'index.ts'), `export const hello = 'world';\n`, 'utf8');

    const result = initProject({
      cwd,
      name: 'brownfield-e2e',
      description: 'A brownfield project under test.',
      source: 'cli',
      pluginRoot,
    });

    expect(result.brownfield).toBe(true);
    expect(existsSync(path.join(cwd, '.swt-planning', 'stack.json'))).toBe(true);
    // detect-stack.sh writes detected_stack as an array. The fixture has
    // tsconfig.json so `typescript` must surface.
    expect(result.stack).toContain('typescript');
  });

  it('AC 13 — parent-repo branch: gitInitialized false + STATE.md activity log notes parent path', () => {
    // Initialize a git repo at the top of the tmpdir, then create a nested
    // subdir and run initProject against the subdir. The probe must
    // classify this as `alreadyExists: 'parent'`.
    execFileSync('git', ['init'], { cwd, stdio: 'pipe' });
    const nested = path.join(cwd, 'nested-project');
    mkdirSync(nested, { recursive: true });

    const result = initProject({
      cwd: nested,
      name: 'nested-project',
      description: 'Inside a parent repo.',
      source: 'cli',
      pluginRoot,
    });

    expect(result.gitInitialized).toBe(false);
    expect(existsSync(path.join(nested, '.git'))).toBe(false);
    const stateContent = readFileSync(path.join(nested, '.swt-planning', 'STATE.md'), 'utf8');
    expect(stateContent).toMatch(/Working inside parent repo at /);
  });

  it('AC 12 (cwd branch) — cwd-repo: pre-existing .git/ → gitInitialized false, no parent-repo activity-log line', () => {
    // Initialize a git repo at the top of the tmpdir, then run initProject
    // against the SAME directory. The probe must classify this as
    // `alreadyExists: 'cwd'` (skip init, no STATE.md activity-log line).
    execFileSync('git', ['init'], { cwd, stdio: 'pipe' });

    const result = initProject({
      cwd,
      name: 'cwd-repo',
      description: 'Repo already in cwd.',
      source: 'cli',
      pluginRoot,
    });

    expect(result.gitInitialized).toBe(false);
    // .git/ still present (from our pre-init).
    expect(existsSync(path.join(cwd, '.git'))).toBe(true);
    const stateContent = readFileSync(path.join(cwd, '.swt-planning', 'STATE.md'), 'utf8');
    // No parent-repo activity-log line.
    expect(stateContent).not.toMatch(/Working inside parent repo at /);
  });
});
