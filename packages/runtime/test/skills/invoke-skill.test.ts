import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { invokeSkill, resolveSkillPath } from '../../src/skills/index.js';

/**
 * Plan 01-04 (Phase 1) Task 2 — invokeSkill contract + path-traversal guard.
 *
 * Six assertions per the plan's verify block:
 *   1. Skill exists ONLY in userSkillsDir → returns user content.
 *   2. Skill exists in BOTH userSkillsDir AND installRoot/skills →
 *      userSkillsDir wins (precedence rule).
 *   3. Skill exists ONLY in installRoot/skills → returns bundled content.
 *   4. Skill does not exist in either → throws Error containing the skill
 *      name + both attempted paths.
 *   5. Invalid skill name (`..` / `/`) → throws Error BEFORE any fs access.
 *   6. Empty / whitespace skill name → throws Error.
 *
 * Each test gets its own tmp dir pair so the suite is parallel-safe and
 * leaves no detritus behind.
 */

describe('@swt-labs/runtime — invokeSkill (Plan 01-04)', () => {
  let userSkillsDir: string;
  let installRoot: string;

  beforeEach(() => {
    userSkillsDir = mkdtempSync(join(tmpdir(), 'swt-user-skills-'));
    installRoot = mkdtempSync(join(tmpdir(), 'swt-install-root-'));
  });

  afterEach(() => {
    rmSync(userSkillsDir, { recursive: true, force: true });
    rmSync(installRoot, { recursive: true, force: true });
  });

  function writeUserSkill(name: string, content: string): string {
    const dir = join(userSkillsDir, name);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'SKILL.md');
    writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  function writeBundledSkill(name: string, content: string): string {
    const dir = join(installRoot, 'skills', name);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'SKILL.md');
    writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  it('returns user-installed SKILL.md content when only userSkillsDir has the skill', () => {
    writeUserSkill('rust-best-practices', '# Rust — user copy\nbody A');

    const content = invokeSkill('rust-best-practices', { userSkillsDir, installRoot });
    expect(content).toBe('# Rust — user copy\nbody A');

    // resolveSkillPath agrees and points at the user tier.
    const resolved = resolveSkillPath('rust-best-practices', { userSkillsDir, installRoot });
    expect(resolved).toBe(join(userSkillsDir, 'rust-best-practices', 'SKILL.md'));
  });

  it('user-installed skill wins when the same skill exists in BOTH tiers', () => {
    writeUserSkill('simplify', '# simplify — USER override');
    writeBundledSkill('simplify', '# simplify — bundled default');

    const content = invokeSkill('simplify', { userSkillsDir, installRoot });
    expect(content).toBe('# simplify — USER override');
    expect(content).not.toContain('bundled default');
  });

  it('falls back to installRoot/skills when only the bundled tier has the skill', () => {
    writeBundledSkill('claude-api', '# claude-api — bundled');

    const content = invokeSkill('claude-api', { userSkillsDir, installRoot });
    expect(content).toBe('# claude-api — bundled');

    const resolved = resolveSkillPath('claude-api', { userSkillsDir, installRoot });
    expect(resolved).toBe(join(installRoot, 'skills', 'claude-api', 'SKILL.md'));
  });

  it('throws an Error naming the skill and BOTH attempted paths when missing in both tiers', () => {
    const expectedUserPath = join(userSkillsDir, 'does-not-exist', 'SKILL.md');
    const expectedBundledPath = join(installRoot, 'skills', 'does-not-exist', 'SKILL.md');

    let caught: Error | null = null;
    try {
      invokeSkill('does-not-exist', { userSkillsDir, installRoot });
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain('does-not-exist');
    expect(caught?.message).toContain(expectedUserPath);
    expect(caught?.message).toContain(expectedBundledPath);

    // resolveSkillPath returns null instead of throwing — the path-resolver
    // is the read-only sibling of invokeSkill.
    expect(resolveSkillPath('does-not-exist', { userSkillsDir, installRoot })).toBeNull();
  });

  it('rejects path-traversal skill names BEFORE any fs access (guard)', () => {
    // Plant a sentinel file so a successful traversal would actually return
    // something — proving the guard short-circuits before existsSync.
    mkdirSync(join(userSkillsDir, 'real'), { recursive: true });
    writeFileSync(join(userSkillsDir, 'real', 'SKILL.md'), 'should never be returned', 'utf8');

    const invalidNames = [
      '../etc/passwd',
      '../../etc/passwd',
      'real/../real',
      'foo/bar',
      '.hidden',
      'has space',
      'with\\backslash',
      '-starts-with-dash',
    ];

    for (const name of invalidNames) {
      expect(() => invokeSkill(name, { userSkillsDir, installRoot })).toThrow(
        /invalid skill name|must not be empty/i,
      );
      expect(() => resolveSkillPath(name, { userSkillsDir, installRoot })).toThrow(
        /invalid skill name|must not be empty/i,
      );
    }
  });

  it('rejects empty and whitespace-only skill names', () => {
    for (const name of ['', '   ', '\t', '\n']) {
      expect(() => invokeSkill(name, { userSkillsDir, installRoot })).toThrow(
        /must not be empty|invalid skill name/i,
      );
      expect(() => resolveSkillPath(name, { userSkillsDir, installRoot })).toThrow(
        /must not be empty|invalid skill name/i,
      );
    }
  });
});
