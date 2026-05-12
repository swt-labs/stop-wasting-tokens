// TODO(v3-debt): tracking https://github.com/swt-labs/stop-wasting-tokens/issues/32
// All describe() blocks below are .skip()-ed pending v2.3.5 test-debt remediation.
// See `docs/decisions/test-debt-tracking.md` for the cluster classification.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');

const PACKAGES = ['core', 'cli', 'methodology', 'artifacts', 'verification', 'telemetry'] as const;

describe.skip('publishConfig parity', () => {
  for (const pkg of PACKAGES) {
    it(`@swt-labs/${pkg}: declares public + provenance + repo + license`, () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      );

      expect(manifest.publishConfig?.access, `${pkg}.publishConfig.access`).toBe('public');
      expect(manifest.publishConfig?.provenance, `${pkg}.publishConfig.provenance`).toBe(true);
      expect(manifest.private, `${pkg}.private must not be true`).not.toBe(true);
      expect(manifest.repository?.url, `${pkg}.repository.url`).toContain(
        'swt-labs/stop-wasting-tokens',
      );
      expect(manifest.license, `${pkg}.license`).toBe('MIT');
      expect(manifest.bugs?.url, `${pkg}.bugs.url`).toContain(
        'github.com/swt-labs/stop-wasting-tokens',
      );
    });
  }

  it('all 7 packages share the same publishConfig shape', () => {
    const configs = PACKAGES.map((pkg) => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      );
      return JSON.stringify(manifest.publishConfig);
    });
    const unique = [...new Set(configs)];
    expect(unique.length, `publishConfig drift: ${unique.join(' | ')}`).toBe(1);
  });
});
