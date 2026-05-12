import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Layered-architecture regression test.
 *
 * Asserts the ESLint configuration in `eslint.config.mjs` (per TDD2 §4.3)
 * actually contains the `no-restricted-imports` and `import/no-restricted-paths`
 * rules that enforce Principle 1 + the layered import graph. Without this
 * test, the rules could silently regress (a config refactor drops a zone,
 * the From→May-import contract breaks, CI stays green because no current
 * source file violates it).
 *
 * Two layers of assertion:
 *
 * 1. **Structural** (always runs) — read `eslint.config.mjs` as text and
 *    verify it carries the layered-architecture zones + the @earendil-works/*
 *    restriction pattern. Cheap, no toolchain dependency.
 *
 * 2. **Behavioural** (Linter API) — instantiate `Linter`, register the
 *    `no-restricted-imports` rule with a minimal config matching what
 *    `eslint.config.mjs` declares for non-runtime packages, and lint a
 *    one-line forbidden import. Asserts the rule actually fires. Avoids
 *    the ts-eslint project-path resolution issue that the full ESLint API
 *    encounters when run from vitest's cwd inside a monorepo.
 *
 * Per ADR-001 (Pi as runtime substrate) + Principle 1: only the runtime
 * layer imports Pi directly. Any future contributor who reintroduces the
 * edge from core/ or methodology/ or anywhere else hits this test.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ESLINT_CONFIG_PATH = join(REPO_ROOT, 'eslint.config.mjs');

describe('@swt-labs/core — eslint layered-architecture boundary', () => {
  describe('Structural: eslint.config.mjs declares the boundary rules', () => {
    const config = readFileSync(ESLINT_CONFIG_PATH, 'utf8');

    it('declares import/no-restricted-paths with the §4.3 zones', () => {
      expect(config).toContain("'import/no-restricted-paths'");
      // The six layer-zones must all appear as targets in the zone array.
      expect(config).toContain("target: 'packages/shared'");
      expect(config).toContain("target: 'packages/core'");
      expect(config).toContain("target: 'packages/runtime'");
      expect(config).toContain("target: 'packages/orchestration'");
      expect(config).toContain("target: 'packages/dashboard'");
      expect(config).toContain("target: 'packages/cli'");
    });

    it('declares no-restricted-imports forbidding @earendil-works/* outside runtime/', () => {
      expect(config).toContain("'no-restricted-imports'");
      expect(config).toContain("group: ['@earendil-works/*']");
      // The override for runtime/ must immediately follow so the ban is
      // not universal (only runtime can import Pi).
      expect(config).toMatch(/packages\/runtime\/\*\*\/\*[\s\S]*?'no-restricted-imports': 'off'/);
    });

    it('keeps shared as the leaf (no other workspace package importable)', () => {
      // Match the shared zone: target shared, from packages, except just shared.
      // Allow flexible whitespace between fields.
      expect(config).toMatch(
        /target: 'packages\/shared',\s*from: 'packages',\s*except: \['packages\/shared'\]/,
      );
    });
  });

  describe('Behavioural: Linter API confirms no-restricted-imports fires', () => {
    it('flags @earendil-works/* import with the configured pattern message', async () => {
      const eslintMod = await import('eslint').catch(() => null);
      if (eslintMod === null) {
        // Skip-with-evidence: ESLint isn't installed as a runtime dep of
        // @swt-labs/core (workspace devDep only). The structural assertions
        // above already cover the contract; this is an additional behavioural
        // check that runs when ESLint is resolvable.

        console.warn(
          'eslint-boundary.test: ESLint not resolvable from this package; ' +
            'behavioural check skipped (structural assertions still passed).',
        );
        expect(true).toBe(true);
        return;
      }
      const { Linter } = eslintMod as {
        Linter: new () => {
          verify: (
            source: string,
            config: unknown,
          ) => Array<{ ruleId: string | null; message: string; severity: number }>;
        };
      };
      const linter = new Linter();

      // Plain JS (no `import type` — the default Linter parser is JS-only).
      // The rule fires on the import statement itself; the source is otherwise irrelevant.
      const source = `import * as pi from '@earendil-works/pi-coding-agent';
console.log(pi);
`;
      const messages = linter.verify(source, {
        // Minimal flat-config: just the no-restricted-imports rule with the
        // pattern mirroring eslint.config.mjs. Avoids ts-eslint and the
        // tsconfig project-path resolution that fails from vitest's cwd.
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  group: ['@earendil-works/*'],
                  message:
                    'Principle 1: only packages/runtime/ may import from @earendil-works/*. See TDD2 §4.3 + ADR-001.',
                },
              ],
            },
          ],
        },
      });

      const violation = messages.find((m) => m.ruleId === 'no-restricted-imports');
      expect(
        violation,
        `Linter messages: ${JSON.stringify(
          messages.map((m) => ({ rule: m.ruleId, msg: m.message })),
        )}`,
      ).toBeDefined();
      expect(violation?.severity).toBe(2);
      expect(violation?.message).toContain('Principle 1');
    });
  });
});
