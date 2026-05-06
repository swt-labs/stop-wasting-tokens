import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');

describe('RELEASE-NOTES-v1.0', () => {
  const path = join(REPO_ROOT, 'RELEASE-NOTES-v1.0.md');

  it('exists at repo root', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('references all 13 prior phases', () => {
    const notes = readFileSync(path, 'utf8');
    const phaseTokens = [
      'Repo',
      'Foundation',
      'Core abstractions',
      'Codex',
      'Methodology authoring',
      'Commands',
      'Artifacts engine',
      'Verification',
      'Methodology runtime',
      'Template fidelity',
      'Documentation site',
      'Distribution',
      'Beta',
    ];
    const missing = phaseTokens.filter(
      (token) => !new RegExp(token, 'i').test(notes),
    );
    expect(missing, `missing phase tokens: ${missing.join(', ')}`).toEqual([]);
  });

  it('references the 4 core abstractions', () => {
    const notes = readFileSync(path, 'utf8');
    for (const abs of ['HookHost', 'AgentSpawner', 'PermissionGate', 'MemoryStore']) {
      expect(notes, `missing abstraction: ${abs}`).toContain(abs);
    }
  });

  it('references the 11 lifecycle states (count, not enumerated)', () => {
    const notes = readFileSync(path, 'utf8');
    expect(notes).toMatch(/[Ee]leven|11.*lifecycle/);
  });

  it('references VBW migration path', () => {
    const notes = readFileSync(path, 'utf8');
    expect(notes).toContain('mv .vbw-planning .swt-planning');
  });
});

describe('CHANGELOG.md', () => {
  const path = join(REPO_ROOT, 'CHANGELOG.md');

  it('exists at repo root', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('follows Keep a Changelog format', () => {
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('Keep a Changelog');
    expect(content).toContain('## [Unreleased]');
    expect(content).toContain('## [1.0.0]');
    expect(content).toContain('## [0.1.0-alpha]');
  });

  it('has Added / Compatibility / Security sections under v1.0.0', () => {
    const content = readFileSync(path, 'utf8');
    const v1Section = content.split('## [1.0.0]')[1]?.split('## [0.1.0-alpha]')[0];
    expect(v1Section, 'v1.0.0 section missing').toBeTruthy();
    expect(v1Section).toContain('### Added');
    expect(v1Section).toContain('### Compatibility');
    expect(v1Section).toContain('### Security');
  });
});
