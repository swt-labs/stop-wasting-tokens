/**
 * Phase 1 — Keychain Credential Adapter: the backend-selecting factory.
 *
 * `resolveCredentialStore(opts?)` is the **Phase 2+ entry point**. It probes
 * the OS keychain (`probeKeychain`); on availability it builds a
 * keychain-backed {@link CredentialStore}, otherwise the read-only env-var
 * fallback (Risk 4). It wraps the selected backend in plan 01-01's
 * `createCredentialStore` codec layer and returns `{store, backend, probe}` —
 * surfacing which backend was chosen plus the raw probe result so Phase 3's
 * dashboard panel can render a 'keychain unavailable' banner.
 *
 * `createCredentialStore` (01-01) stays the lower-level primitive for callers
 * who already hold a backend; `resolveCredentialStore` is the one that *picks*
 * the backend. `forceBackend` lets tests + Phase-2 callsites pin a backend
 * deterministically without depending on host keychain state.
 */

import type { CredentialStore } from './types.js';
import { createCredentialStore } from './credential-store.js';
import { createKeychainBackend } from './keychain-backend.js';
import { createEnvFallbackBackend } from './env-fallback-backend.js';
import { probeKeychain, type KeychainProbeResult } from './probe.js';
import { SWT_KEYCHAIN_SERVICE } from './namespace.js';

/** Options for {@link resolveCredentialStore}. */
export interface ResolveCredentialStoreOptions {
  /** Keychain `service` value; defaults to {@link SWT_KEYCHAIN_SERVICE}. */
  readonly service?: string;
  /**
   * Pin a backend deterministically — for tests and Phase-2 callsites that
   * already know the host's keychain state. When omitted, `probeKeychain`
   * decides.
   */
  readonly forceBackend?: 'keychain' | 'env-fallback';
}

/** The result of {@link resolveCredentialStore} — the wired store plus the
 *  chosen `backend` tag and the raw `probe` result for UI surfacing. */
export interface ResolvedCredentialStore {
  readonly store: CredentialStore;
  readonly backend: 'keychain' | 'env-fallback';
  readonly probe: KeychainProbeResult;
}

/**
 * Probe the OS keychain and build the appropriate {@link CredentialStore}:
 * keychain-backed when available, the read-only env-var fallback otherwise
 * (Risk 4). Surfaces `{store, backend, probe}` so callers can both use the
 * store and render an availability banner.
 *
 * @param opts - optional `service` override and `forceBackend` escape hatch.
 */
export async function resolveCredentialStore(
  opts?: ResolveCredentialStoreOptions,
): Promise<ResolvedCredentialStore> {
  const service = opts?.service ?? SWT_KEYCHAIN_SERVICE;

  // forceBackend short-circuits the probe entirely (deterministic for tests +
  // Phase-2 callsites); otherwise the live probe decides.
  let probe: KeychainProbeResult;
  if (opts?.forceBackend === 'keychain') {
    probe = { available: true };
  } else if (opts?.forceBackend === 'env-fallback') {
    probe = { available: false, reason: 'forced env-fallback backend' };
  } else {
    probe = await probeKeychain();
  }

  if (probe.available) {
    return {
      store: createCredentialStore({ backend: createKeychainBackend(service), service }),
      backend: 'keychain',
      probe,
    };
  }
  return {
    store: createCredentialStore({ backend: createEnvFallbackBackend(), service }),
    backend: 'env-fallback',
    probe,
  };
}
