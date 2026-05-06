import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

const PACKAGES = [
  'core',
  'cli',
  'codex-driver',
  'methodology',
  'artifacts',
  'verification',
  'telemetry',
] as const;

describe('publishConfig parity', () => {
  for (const pkg of PACKAGES) {
    it(`@swt-labs/${pkg}: declares public + provenance + repo + license`, () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf8')
      );

      expect(manifest.publishConfig?.access, `${pkg}.publishConfig.access`).toBe('public');
      expect(manifest.publishConfig?.provenance, `${pkg}.publishConfig.provenance`).toBe(true);
      expect(manifest.private, `${pkg}.private must not be true`).not.toBe(true);
      expect(
        manifest.repository?.url,
        `${pkg}.repository.url`
      ).toContain('swt-labs/stop-wasting-tokens');
      expect(manifest.license, `${pkg}.license`).toBe('MIT');
      expect(manifest.bugs?.url, `${pkg}.bugs.url`).toContain(
        'github.com/swt-labs/stop-wasting-tokens'
      );
    });
  }

  it('all 7 packages share the same publishConfig shape', () => {
    const configs = PACKAGES.map((pkg) => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf8')
      );
      return JSON.stringify(manifest.publishConfig);
    });
    const unique = [...new Set(configs)];
    expect(unique.length, `publishConfig drift: ${unique.join(' | ')}`).toBe(1);
  });
});
