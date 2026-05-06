import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const manifestPath = join(__dirname, '..', 'codex-plugin.json');

describe('codex-plugin.json (Codex Plugin Marketplace manifest)', () => {
  it('parses as valid JSON', () => {
    const raw = readFileSync(manifestPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('does not reference RFC-2606 reserved or placeholder schema URLs', () => {
    const raw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    if (typeof manifest.$schema === 'string') {
      // If a $schema is declared, it must not point at reserved / placeholder
      // hosts that would never resolve in the marketplace validator.
      expect(manifest.$schema).not.toMatch(/\.example(\.|$)/i);
      expect(manifest.$schema).not.toMatch(/example\.com/i);
    }
  });

  it('declares the canonical SWT install metadata', () => {
    const raw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    expect(manifest.name).toBe('stop-wasting-tokens');
    expect(manifest.install).toMatchObject({
      npm: '@swt-labs/cli',
      command: 'swt',
    });
  });

  it('lists at least the four primary swt commands', () => {
    const raw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as { commands: { name: string }[] };
    const commandNames = manifest.commands.map((c) => c.name);
    for (const name of ['swt init', 'swt vibe', 'swt detect-phase', 'swt update']) {
      expect(commandNames).toContain(name);
    }
  });
});
