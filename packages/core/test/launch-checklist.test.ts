import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const PATH = join(REPO_ROOT, 'LAUNCH-CHECKLIST.md');

describe('LAUNCH-CHECKLIST.md', () => {
  it('exists at repo root', () => {
    expect(existsSync(PATH)).toBe(true);
  });

  it('has the canonical sections', () => {
    const content = readFileSync(PATH, 'utf8');
    const sections = [
      '## Pre-flight',
      '## npm publish',
      '## Marketplace submission',
      '## Docs deploy',
      '## VBW deprecation',
      '## Announcements',
      '## Demo video',
      '## Post-launch monitoring',
      '## Post-launch follow-up',
    ];
    for (const section of sections) {
      expect(content, `missing section: ${section}`).toContain(section);
    }
  });

  it('references the engineering→ship handoff items', () => {
    const content = readFileSync(PATH, 'utf8');
    for (const ref of [
      'NPM_TOKEN',
      'bump-version.sh',
      'codex-plugin.json',
      'discord',
      'docs.stopwastingtokens.dev',
      'release.yml',
      'install-smoke.yml',
      'demo-video-script.md',
    ]) {
      expect(content, `missing reference: ${ref}`).toMatch(new RegExp(ref, 'i'));
    }
  });

  it('cross-references SECURITY-REVIEW for placeholder inventory', () => {
    const content = readFileSync(PATH, 'utf8');
    expect(content).toContain('SECURITY-REVIEW-v1.0.md');
  });
});

describe('vbw-deprecation-notice.md', () => {
  const path = join(
    REPO_ROOT,
    '.vbw-planning',
    'announcements',
    'vbw-deprecation-notice.md',
  );

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('mentions migration command + SWT links', () => {
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('mv .vbw-planning .swt-planning');
    expect(content).toContain('docs.stopwastingtokens.dev');
    expect(content).toContain('@swt-labs/cli');
  });
});

describe('demo-video-script.md', () => {
  const path = join(
    REPO_ROOT,
    '.vbw-planning',
    'announcements',
    'demo-video-script.md',
  );

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('has timing markers covering the full 5-8 minute target', () => {
    const content = readFileSync(path, 'utf8');
    // Spot-check key sections by their timing headings
    for (const marker of ['0:00', '0:15', '1:00', '2:00', '4:00', '5:30', '6:00']) {
      expect(content, `missing timing marker: ${marker}`).toContain(marker);
    }
  });

  it('walks the full lifecycle (install → plan/execute → UAT → archive)', () => {
    const content = readFileSync(path, 'utf8');
    expect(content.toLowerCase()).toContain('install');
    expect(content.toLowerCase()).toContain('execute');
    expect(content.toLowerCase()).toContain('uat');
    expect(content.toLowerCase()).toContain('archive');
  });
});
