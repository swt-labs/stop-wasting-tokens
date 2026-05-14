/**
 * Plan 01-03 (Phase 1) — mechanical L2 layering + native-isolation verification.
 *
 * Two invariants, both checked data-driven over every `.ts` SOURCE file under
 * `packages/runtime/src/credentials/` (never the test files):
 *
 *  1. **L2 layering** (CLAUDE.md) — `runtime` is L2: it may import only from
 *     `core` / `shared` / within-package. An upward import to any L3+ package
 *     (`orchestration` / `methodology` / `test-utils` / `cli` / `dashboard`)
 *     is a build error. This test fails CI on the FIRST such import.
 *  2. **Native-dep isolation** (01-02 invariant) — the native `@napi-rs/keyring`
 *     module is imported in EXACTLY `keychain-backend.ts` (static) + `probe.ts`
 *     (dynamic) and nowhere else in the module. Every other `credentials/`
 *     source file — including the `index.ts` sub-barrel — is native-dep-free.
 *
 * It is string-`includes`-based over the COMMENT-STRIPPED source, not an AST
 * parse: cheap, dependency-free, and sufficient — an `import` statement for a
 * forbidden package always contains the bare specifier string, while JSDoc
 * prose that merely *names* `@napi-rs/keyring` (e.g. `credential-store.ts` and
 * `types.ts` both document the seam) is correctly NOT a violation. Stripping
 * comments first is what makes the invariant mean "no forbidden *import*"
 * rather than "no forbidden *mention*". Data-driven over `readdirSync`, so a
 * `credentials/` file added later automatically falls under the check.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Resolve the credentials/ source dir relative to this test file.
const CREDENTIALS_SRC = path.resolve(__dirname, '../../src/credentials');

/**
 * Strip `/* *\/` block comments and `//` line comments so the import checks
 * below see only executable code — a forbidden specifier named in JSDoc prose
 * (the credentials module documents the native seam in several module docs)
 * is NOT an import and must not trip the invariant. Dependency-free, no AST.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// L2 constraint (CLAUDE.md): runtime may import core/shared/within-package
// ONLY. An upward import to any of these L3+ packages is a build error.
const FORBIDDEN_UPWARD = [
  '@swt-labs/orchestration',
  '@swt-labs/methodology',
  '@swt-labs/test-utils',
  '@swt-labs/cli',
  '@swt-labs/dashboard',
];

// 01-02 isolation invariant: the native module is imported in exactly these
// two files and nowhere else in the credentials/ module.
const NATIVE_SPECIFIER = '@napi-rs/keyring';
const NATIVE_ALLOWED_FILES = ['keychain-backend.ts', 'probe.ts'];

function credentialSourceFiles(): string[] {
  return readdirSync(CREDENTIALS_SRC)
    .filter((f) => f.endsWith('.ts'))
    .sort();
}

describe('@swt-labs/runtime — credentials/ L2 layering invariants (Phase 1)', () => {
  it('no credentials/ source file imports an L3+ (upward) package', () => {
    for (const file of credentialSourceFiles()) {
      const code = stripComments(
        readFileSync(path.join(CREDENTIALS_SRC, file), 'utf8'),
      );
      for (const forbidden of FORBIDDEN_UPWARD) {
        expect(
          code.includes(forbidden),
          `${file} must not import ${forbidden} — runtime is L2`,
        ).toBe(false);
      }
    }
  });

  it('the native @napi-rs/keyring import is isolated to keychain-backend.ts + probe.ts', () => {
    for (const file of credentialSourceFiles()) {
      if (NATIVE_ALLOWED_FILES.includes(file)) continue;
      const code = stripComments(
        readFileSync(path.join(CREDENTIALS_SRC, file), 'utf8'),
      );
      expect(
        code.includes(NATIVE_SPECIFIER),
        `${file} must not import ${NATIVE_SPECIFIER} — native access is isolated to ${NATIVE_ALLOWED_FILES.join(' + ')}`,
      ).toBe(false);
    }
  });

  it('credentials/index.ts (sub-barrel) is itself native-dep-free', () => {
    const code = stripComments(
      readFileSync(path.join(CREDENTIALS_SRC, 'index.ts'), 'utf8'),
    );
    expect(code.includes(NATIVE_SPECIFIER)).toBe(false);
  });
});
