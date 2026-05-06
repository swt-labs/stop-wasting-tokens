import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG_DIR = join(__dirname, '..');
const REPO_ROOT = join(PKG_DIR, '..', '..');

const manifest = JSON.parse(
  readFileSync(join(PKG_DIR, 'codex-plugin.json'), 'utf8'),
) as {
  name: string;
  displayName: string;
  version: string;
  description: string;
  install: { npm: string; command: string };
  commands: Array<{ name: string; description: string }>;
  tags: string[];
  license: string;
  repository: string;
};

const cliPkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));

describe('codex-plugin.json', () => {
  it('declares core identity fields', () => {
    expect(manifest.name).toBe('stop-wasting-tokens');
    expect(manifest.displayName).toContain('SWT');
    expect(manifest.install?.npm).toBe('@swt-labs/cli');
    expect(manifest.install?.command).toBe('swt');
    expect(manifest.license).toBe('MIT');
    expect(manifest.repository).toContain('swt-labs/stop-wasting-tokens');
  });

  it('lists all commands the CLI registers', () => {
    expect(Array.isArray(manifest.commands)).toBe(true);
    const names = manifest.commands.map((c) => c.name);
    // Spot-check the load-bearing commands are listed
    expect(names).toEqual(
      expect.arrayContaining([
        'swt init',
        'swt vibe',
        'swt detect-phase',
        'swt update',
      ]),
    );
  });

  it('every command has a non-empty description', () => {
    for (const cmd of manifest.commands) {
      expect(cmd.description.length, `${cmd.name} description`).toBeGreaterThan(0);
    }
  });

  it('declares marketplace tags', () => {
    expect(manifest.tags).toEqual(
      expect.arrayContaining(['methodology', 'cli', 'codex']),
    );
  });

  it('version stays in sync with cli package.json', () => {
    expect(manifest.version).toBe(cliPkg.version);
  });

  it('version stays in sync with root package.json', () => {
    expect(manifest.version).toBe(rootPkg.version);
  });
});
