import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const REVIEW_PATH = join(REPO_ROOT, 'SECURITY-REVIEW-v1.0.md');

describe('SECURITY-REVIEW-v1.0', () => {
  it('exists at repo root', () => {
    expect(existsSync(REVIEW_PATH)).toBe(true);
  });

  it('has all 5 canonical review sections', () => {
    const content = readFileSync(REVIEW_PATH, 'utf8');
    const sections = [
      '## 1. Input handling',
      '## 2. Filesystem access',
      '## 3. Network',
      '## 4. Child process',
      '## 5. Secrets handling',
    ];
    for (const section of sections) {
      expect(content, `missing: ${section}`).toContain(section);
    }
  });

  it('includes dependency audit + placeholder URL inventory', () => {
    const content = readFileSync(REVIEW_PATH, 'utf8');
    expect(content).toContain('Dependency audit');
    expect(content).toContain('Placeholder URL inventory');
  });

  it('includes license + copyright sweep section', () => {
    const content = readFileSync(REVIEW_PATH, 'utf8');
    expect(content).toContain('License + copyright sweep');
  });

  it('has a Summary table', () => {
    const content = readFileSync(REVIEW_PATH, 'utf8');
    expect(content).toMatch(/\|\s*Section\s*\|\s*Findings\s*\|\s*Status\s*\|/);
  });
});

describe('LICENSE', () => {
  it('exists at repo root and declares MIT for the current year', () => {
    const path = join(REPO_ROOT, 'LICENSE');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('MIT License');
    const currentYear = new Date().getFullYear();
    expect(content, `LICENSE missing year ${currentYear}`).toMatch(
      new RegExp(String(currentYear)),
    );
  });
});
