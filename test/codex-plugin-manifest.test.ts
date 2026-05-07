import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const manifestPath = join(REPO_ROOT, '.codex-plugin', 'plugin.json');
const packageJsonPath = join(REPO_ROOT, 'package.json');

interface CodexPluginManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly author?: unknown;
  readonly license?: unknown;
  readonly homepage?: unknown;
  readonly repository?: unknown;
  readonly keywords?: unknown;
  readonly interface?: unknown;
  readonly $schema?: unknown;
  // Undocumented top-level fields that must NOT appear:
  readonly install?: unknown;
  readonly commands?: unknown;
  readonly tags?: unknown;
  readonly categories?: unknown;
  readonly displayName?: unknown;
  readonly screenshots?: unknown;
}

describe('codex-plugin.json (Codex Plugin Marketplace manifest)', () => {
  it('lives at the documented Codex path .codex-plugin/plugin.json', () => {
    expect(() => readFileSync(manifestPath, 'utf8')).not.toThrow();
  });

  it('parses as valid JSON', () => {
    const raw = readFileSync(manifestPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('declares the required Codex top-level fields (name, version, description)', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CodexPluginManifest;
    expect(typeof manifest.name).toBe('string');
    expect(typeof manifest.version).toBe('string');
    expect(typeof manifest.description).toBe('string');
    expect(manifest.name).toBe('stop-wasting-tokens');
  });

  it('omits undocumented top-level fields (install, commands, tags, categories, displayName, screenshots)', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CodexPluginManifest;
    // F-13 — these fields belong inside `interface` or were dropped entirely.
    expect(manifest.install).toBeUndefined();
    expect(manifest.commands).toBeUndefined();
    expect(manifest.tags).toBeUndefined();
    expect(manifest.categories).toBeUndefined();
    expect(manifest.displayName).toBeUndefined();
    expect(manifest.screenshots).toBeUndefined();
  });

  it('declares an interface block with displayName, category, and screenshots', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CodexPluginManifest;
    expect(typeof manifest.interface).toBe('object');
    const iface = manifest.interface as Record<string, unknown>;
    expect(typeof iface.displayName).toBe('string');
    expect(typeof iface.category).toBe('string');
    expect(Array.isArray(iface.screenshots)).toBe(true);
  });

  it('declares author as an object with name (not a bare string)', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CodexPluginManifest;
    expect(typeof manifest.author).toBe('object');
    expect(manifest.author).not.toBeNull();
    const author = manifest.author as Record<string, unknown>;
    expect(typeof author.name).toBe('string');
  });

  it('declares keywords as an array of strings', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CodexPluginManifest;
    expect(Array.isArray(manifest.keywords)).toBe(true);
    const keywords = manifest.keywords as unknown[];
    expect(keywords.length).toBeGreaterThan(0);
    for (const keyword of keywords) {
      expect(typeof keyword).toBe('string');
    }
  });

  it('version field matches package.json version exactly (drift detection)', () => {
    // F-14 — the manifest version must stay in sync with the npm package version.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CodexPluginManifest;
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    expect(manifest.version).toBe(pkg.version);
  });

  it('does not reference RFC-2606 reserved or placeholder schema URLs', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CodexPluginManifest;
    if (typeof manifest.$schema === 'string') {
      expect(manifest.$schema).not.toMatch(/\.example(\.|$)/i);
      expect(manifest.$schema).not.toMatch(/example\.com/i);
    }
  });
});
