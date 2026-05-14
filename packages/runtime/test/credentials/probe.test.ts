/**
 * Phase 1 / plan 01-02 — unit tests for `probeKeychain`.
 *
 * The probe must NEVER touch a real OS keychain (CI runners have none, and a
 * real keychain would prompt or fail). `@napi-rs/keyring` is `vi.doMock`'d with
 * a fake `Entry` class per test; because `probeKeychain` uses a *dynamic*
 * `import('@napi-rs/keyring')`, each test sets up its mock, `vi.resetModules()`,
 * then dynamic-`import`s the module under test — the same pattern
 * `session.real-pi.test.ts` uses for a dynamically-imported native dep.
 *
 * Coverage:
 *  1. Available — fake Entry round-trips the sentinel -> {available: true}.
 *  2. Round-trip mismatch — getPassword returns a different value
 *     -> {available: false} with a non-empty reason.
 *  3. Op throws — getPassword throws -> {available: false}, probe did NOT throw.
 *  4. Module load fails — the import itself throws -> {available: false},
 *     probe did NOT throw.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('@swt-labs/runtime — probeKeychain (Plan 01-02)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@napi-rs/keyring');
    vi.restoreAllMocks();
  });

  it('returns {available: true} when the native keychain round-trips the sentinel', async () => {
    vi.doMock('@napi-rs/keyring', () => ({
      // Fake Entry: setPassword stores to an instance field, getPassword
      // returns it, deletePassword is a no-op. A faithful round-trip.
      Entry: class FakeEntry {
        private stored: string | null = null;
        constructor(
          public service: string,
          public account: string,
        ) {}
        setPassword(password: string): void {
          this.stored = password;
        }
        getPassword(): string | null {
          return this.stored;
        }
        deletePassword(): boolean {
          const had = this.stored !== null;
          this.stored = null;
          return had;
        }
      },
    }));
    vi.resetModules();
    const { probeKeychain } = await import('../../src/credentials/probe.js');

    const result = await probeKeychain();
    expect(result.available).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns {available: false} with a reason when the round-trip value mismatches', async () => {
    vi.doMock('@napi-rs/keyring', () => ({
      // Fake Entry whose getPassword returns a DIFFERENT value than was set —
      // simulates a keychain that "works" but is somehow returning garbage.
      Entry: class FakeEntry {
        constructor(
          public service: string,
          public account: string,
        ) {}
        setPassword(_password: string): void {
          /* swallow */
        }
        getPassword(): string | null {
          return 'a-completely-different-value';
        }
        deletePassword(): boolean {
          return true;
        }
      },
    }));
    vi.resetModules();
    const { probeKeychain } = await import('../../src/credentials/probe.js');

    const result = await probeKeychain();
    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it('returns {available: false} and does NOT throw when a keychain op throws', async () => {
    vi.doMock('@napi-rs/keyring', () => ({
      // Fake Entry whose getPassword throws — simulates a locked keychain /
      // no Secret Service daemon on a headless host.
      Entry: class FakeEntry {
        constructor(
          public service: string,
          public account: string,
        ) {}
        setPassword(_password: string): void {
          /* set succeeds */
        }
        getPassword(): string | null {
          throw new Error('SecKeychainItemCopyContent: keychain is locked');
        }
        deletePassword(): boolean {
          return false;
        }
      },
    }));
    vi.resetModules();
    const { probeKeychain } = await import('../../src/credentials/probe.js');

    // The probe itself must resolve — never throw.
    await expect(probeKeychain()).resolves.toMatchObject({ available: false });
    const result = await probeKeychain();
    expect(result.reason).toBeTruthy();
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it('returns {available: false} and does NOT throw when the native module fails to load', async () => {
    vi.doMock('@napi-rs/keyring', () => {
      // The import itself throws — simulates a missing prebuilt binary on an
      // exotic platform. The dynamic import in probe.ts must catch this.
      throw new Error('Cannot find module @napi-rs/keyring-exotic-platform');
    });
    vi.resetModules();
    const { probeKeychain } = await import('../../src/credentials/probe.js');

    await expect(probeKeychain()).resolves.toMatchObject({ available: false });
    const result = await probeKeychain();
    expect(result.reason).toBeTruthy();
    expect(result.reason!.length).toBeGreaterThan(0);
  });
});
