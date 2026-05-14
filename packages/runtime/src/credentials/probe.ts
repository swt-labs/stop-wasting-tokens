/**
 * Phase 1 — Keychain Credential Adapter: the OS-keychain availability probe.
 *
 * `probeKeychain()` does a NON-DESTRUCTIVE set/get/delete round-trip under a
 * reserved `'__swt_probe__'` account to confirm the OS keychain genuinely
 * works on THIS host — not merely that the native module loaded. CI runners,
 * headless Linux with no Secret Service daemon, and login keychains locked
 * over SSH all load the module fine but fail the actual round-trip; the probe
 * catches exactly that.
 *
 * **Never throws** — always resolves a {@link KeychainProbeResult}. It uses a
 * *dynamic* `import('@napi-rs/keyring')` (mirroring
 * `runtime/src/probe.ts:probePiAvailable`) so a missing prebuilt binary on an
 * exotic platform degrades to `{available: false}` instead of crashing module
 * load. Phase 1 / Risk 4 — the `resolveCredentialStore` factory consumes this
 * to pick the keychain backend vs the read-only env-var fallback.
 */

import { SWT_KEYCHAIN_SERVICE } from './namespace.js';

/** The result of {@link probeKeychain} — `available` plus, when unavailable,
 *  a one-line human-readable `reason` derived from the caught error. */
export interface KeychainProbeResult {
  readonly available: boolean;
  readonly reason?: string;
}

/** Reserved probe account — kept out of `listAccounts` by the keychain backend. */
const PROBE_ACCOUNT = '__swt_probe__';
/** Sentinel value the probe writes + reads back to confirm a real round-trip. */
const PROBE_SENTINEL = 'swt-keychain-probe-ok';

/**
 * Non-destructively confirm the OS keychain genuinely works on this host:
 * `setPassword` a sentinel under `'__swt_probe__'`, `getPassword` it back and
 * compare, then `deletePassword` it. Returns `{available: true}` only if every
 * step succeeds and the round-tripped value matches.
 *
 * If the native module fails to load (missing prebuilt binary), or any
 * keychain op throws (no Secret Service daemon, locked keychain over SSH, CI
 * runner), or the round-trip value mismatches, returns
 * `{available: false, reason}`. **Never throws.**
 */
export async function probeKeychain(): Promise<KeychainProbeResult> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const entry = new Entry(SWT_KEYCHAIN_SERVICE, PROBE_ACCOUNT);
    entry.setPassword(PROBE_SENTINEL);
    const readback = entry.getPassword();
    // Best-effort cleanup — never let a delete failure mask an otherwise
    // successful round-trip, but if set/get already succeeded the keychain is
    // demonstrably working.
    entry.deletePassword();
    if (readback !== PROBE_SENTINEL) {
      return {
        available: false,
        reason:
          'OS keychain round-trip mismatch — set/get returned an unexpected value.',
      };
    }
    return { available: true };
  } catch (err) {
    return {
      available: false,
      reason:
        'OS keychain unavailable on this host (CI / SSH / headless Linux with no ' +
        'Secret Service daemon, or missing native binary): ' +
        (err instanceof Error ? err.message : String(err)),
    };
  }
}
