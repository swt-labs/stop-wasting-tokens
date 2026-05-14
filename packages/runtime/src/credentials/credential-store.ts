/**
 * Phase 1 — Keychain Credential Adapter: the backend-agnostic codec layer.
 *
 * `createCredentialStore(opts)` builds a {@link CredentialStore} over an
 * injected {@link CredentialBackend}. It is a thin codec layer: it translates
 * `(provider, authMode)` <-> the backend `account` string (via `namespace.ts`)
 * and delegates ALL IO to the backend. It performs NO native IO and imports
 * NOTHING from `@napi-rs/keyring` — that is the entire point of the seam.
 *
 * The native keychain backend and the env-var-passthrough fallback backend
 * (plan 01-02) both implement the same {@link CredentialBackend} interface
 * and are injected here; plan 01-01 unit-tests this layer against
 * `createInMemoryBackend()`.
 *
 * `list()` maps backend accounts back through `decodeAccount`, SILENTLY
 * SKIPPING any account that fails to decode — a real keychain's
 * `listAccounts` may surface non-SWT entries the `service` filter did not
 * catch; those are not errors, just not ours. The store is a library, so the
 * skip is silent (no `console.*`).
 *
 * L2 layering: this module imports only within `runtime` (`./types.js`,
 * `./namespace.js`) — it imports neither `core` nor `shared`, which is fine.
 * The L2 rule forbids importing *upward* (L3+), not failing to import
 * downward; the formal layering verification is plan 01-03.
 */

import { SWT_KEYCHAIN_SERVICE, decodeAccount, encodeAccount } from './namespace.js';
import type { AuthMode, CredentialRef, CredentialStore, CredentialStoreOptions } from './types.js';

/**
 * Build a {@link CredentialStore} over an injected {@link CredentialBackend}.
 *
 * Backend-agnostic by construction — does codec translation only and
 * delegates every IO call to `opts.backend`. No native module is imported or
 * touched here.
 *
 * @param opts - the injected backend plus an optional keychain `service`
 *   (defaults to `'swt'`; consumed by plan 01-02's native backend factory).
 */
export function createCredentialStore(opts: CredentialStoreOptions): CredentialStore {
  const { backend } = opts;
  // `service` is reserved for the native backend in plan 01-02 (it keys the
  // keychain `service` field). Phase 1's codec layer only needs the `account`
  // half, but the option is defaulted + threaded here so it is wired
  // end-to-end and 01-02 does not have to churn the interface.
  const _service = opts.service ?? SWT_KEYCHAIN_SERVICE;
  void _service;

  return {
    async get(provider: string, authMode: AuthMode): Promise<string | undefined> {
      return backend.getSecret(encodeAccount(provider, authMode));
    },
    async set(provider: string, authMode: AuthMode, secret: string): Promise<void> {
      await backend.setSecret(encodeAccount(provider, authMode), secret);
    },
    async delete(provider: string, authMode: AuthMode): Promise<boolean> {
      return backend.deleteSecret(encodeAccount(provider, authMode));
    },
    async list(): Promise<CredentialRef[]> {
      const accounts = await backend.listAccounts();
      const refs: CredentialRef[] = [];
      for (const account of accounts) {
        try {
          refs.push(decodeAccount(account));
        } catch {
          // Non-SWT or malformed entry — skip, do not throw. The store is a
          // library: no console.* here.
        }
      }
      return refs;
    },
  };
}
