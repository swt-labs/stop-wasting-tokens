import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DOCS_ROOT = join(__dirname, '..');

const haveVale = (() => {
  try {
    execFileSync('vale', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const isCI = process.env.CI === 'true';

describe.skipIf(!haveVale && !isCI)('vale prose lint', () => {
  it('returns zero error-severity violations across docs/', () => {
    let stdout: string;
    try {
      stdout = execFileSync('vale', ['--output=JSON', '.'], {
        cwd: DOCS_ROOT,
        encoding: 'utf8',
      });
    } catch (err: any) {
      stdout = err.stdout?.toString() ?? '';
    }

    if (!stdout.trim()) {
      // Vale returns empty when no findings at all
      expect(true).toBe(true);
      return;
    }

    const json = JSON.parse(stdout) as Record<string, Array<{ Severity: string; Check: string; Match: string }>>;
    const errors: Array<{ file: string; check: string; match: string }> = [];

    for (const [file, violations] of Object.entries(json)) {
      for (const v of violations) {
        if (v.Severity === 'error') {
          errors.push({ file, check: v.Check, match: v.Match });
        }
      }
    }

    expect(
      errors,
      `vale errors found:\n${errors.map((e) => `  ${e.file}: ${e.check} (${e.match})`).join('\n')}`
    ).toEqual([]);
  });
});
