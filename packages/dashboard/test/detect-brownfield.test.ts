import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectBrownfield } from '../src/server/lib/detect-brownfield.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swt-brownfield-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectBrownfield', () => {
  it('returns false for an empty directory (pure greenfield)', () => {
    expect(detectBrownfield(dir)).toBe(false);
  });

  it('returns true when a single tracked file exists', () => {
    writeFileSync(join(dir, 'README.md'), '# hi');
    expect(detectBrownfield(dir)).toBe(true);
  });

  it('returns true when package.json + node_modules both exist (real-world repo)', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    mkdirSync(join(dir, 'node_modules'));
    expect(detectBrownfield(dir)).toBe(true);
  });

  it('returns false when only hidden entries exist (.git, .DS_Store)', () => {
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.DS_Store'), '');
    expect(detectBrownfield(dir)).toBe(false);
  });

  it('returns false when only ignored build artifacts exist (node_modules, dist)', () => {
    mkdirSync(join(dir, 'node_modules'));
    mkdirSync(join(dir, 'dist'));
    expect(detectBrownfield(dir)).toBe(false);
  });

  it('returns true for a single source file with hidden + ignored siblings', () => {
    writeFileSync(join(dir, 'index.ts'), '');
    mkdirSync(join(dir, '.git'));
    mkdirSync(join(dir, 'node_modules'));
    expect(detectBrownfield(dir)).toBe(true);
  });

  it('returns false when the directory does not exist (defensive default)', () => {
    expect(detectBrownfield(join(dir, 'does-not-exist'))).toBe(false);
  });

  it('ignores other build artifacts (build, coverage, target, .next, .venv, vendor)', () => {
    for (const name of ['build', 'coverage', 'target', '.next', '.venv', 'vendor']) {
      mkdirSync(join(dir, name));
    }
    expect(detectBrownfield(dir)).toBe(false);
  });

  it('treats a directory full of source as brownfield', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), '');
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    expect(detectBrownfield(dir)).toBe(true);
  });
});
