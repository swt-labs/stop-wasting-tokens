/**
 * Phase 1 — Keychain Credential Adapter: the **backend-agnostic** type contract.
 *
 * This module defines the seam every credential backend implements and the
 * public `CredentialStore` API the rest of SWT consumes. It is types-only —
 * no runtime code, no imports. The native `@napi-rs/keyring` backend and the
 * env-var-passthrough fallback backend (plan 01-02) both implement
 * {@link CredentialBackend}; plan 01-01 ships the in-memory reference
 * implementation for unit tests.
 *
 * Risk 1 (Lead risk register) — the keychain library is `@napi-rs/keyring@1.3.0`,
 * but it is a *native* module. Keeping the contract native-dep-free here means
 * the in-memory backend + the codec layer compile and test in complete
 * isolation; the native dependency add lands in plan 01-02.
 *
 * Risk 4 (Lead risk register) — the headless fallback is a read-only env-var
 * passthrough backend. {@link CredentialBackend} only needs to *permit* a
 * backend method to reject (the fallback's `setSecret`/`deleteSecret` throw
 * clearly rather than silently dropping the write) — and `Promise`-returning
 * methods do permit rejection, so no extra surface is needed here.
 *
 * Research §6 (security — namespacing) — keychain entries are namespaced
 * `swt:<provider>:<authMode>`: `service = 'swt'`, `account = '<provider>:<authMode>'`.
 * The codec that produces the `account` half lives in `./namespace.ts`. The
 * `account` parameter on {@link CredentialBackend} is *already* that encoded
 * key — backends never re-encode. Credentials are never logged and never
 * written outside the keychain (in plan 01-01, the in-memory backend); see
 * research §6 never-log / never-persist rules.
 */

/**
 * The two credential kinds. Phase 1 persists opaque secret strings under
 * both; Phase 4 stores serialized `OAuthCredentials` JSON under `'oauth'` via
 * the SAME `set`/`get` — so the store API is authMode-agnostic by
 * construction and needs no change when OAuth lands. (Research §6, Phase 1.)
 */
export type AuthMode = 'api_key' | 'oauth';

/**
 * The decoded, SECRET-FREE shape {@link CredentialStore.list} returns. Never
 * carries the secret value — only which `(provider, authMode)` pairs exist in
 * the store. This is the only credential-shaped object that is safe to log or
 * surface to a UI (research §6 — the dashboard panel shows auth *status*, not
 * the secret).
 */
export interface CredentialRef {
  readonly provider: string;
  readonly authMode: AuthMode;
}

/**
 * The pluggable storage seam — the four-method interface every backend
 * implements. `account` is the already-encoded namespace key produced by
 * `namespace.ts:encodeAccount` (e.g. `'openai:api_key'`); backends store it
 * verbatim and never re-encode.
 *
 * Plan 01-02 implements this against the OS keychain (`@napi-rs/keyring`,
 * Risk 1) and against an env-var-passthrough fallback (Risk 4); plan 01-01
 * ships `createInMemoryBackend()` — the `Map`-backed reference implementation
 * that ALL Phase 1 unit tests run against (no real OS keychain in CI).
 *
 * Every method is async: the real keychain backend is genuinely async, and a
 * `Promise`-returning method may reject — which is exactly how the env-var
 * fallback's `setSecret`/`deleteSecret` surface "this host is read-only"
 * (Risk 4).
 */
export interface CredentialBackend {
  /** Resolve the secret for an encoded `account`, or `undefined` if none. */
  getSecret(account: string): Promise<string | undefined>;
  /** Store (overwrite) the secret for an encoded `account`. */
  setSecret(account: string, secret: string): Promise<void>;
  /** Remove an entry. `true` if an entry was removed, `false` if none existed. */
  deleteSecret(account: string): Promise<boolean>;
  /** List every encoded `account` key the backend currently holds. */
  listAccounts(): Promise<string[]>;
}

/**
 * The public credential API. `provider` + `authMode` in; an opaque secret
 * string out. `list()` returns {@link CredentialRef}s only — NEVER secrets
 * (research §6). A {@link CredentialStore} is a thin codec layer over an
 * injected {@link CredentialBackend} — see `credential-store.ts`.
 */
export interface CredentialStore {
  /** Resolve the secret for `(provider, authMode)`, or `undefined` if unset. */
  get(provider: string, authMode: AuthMode): Promise<string | undefined>;
  /** Store (overwrite) the secret for `(provider, authMode)`. */
  set(provider: string, authMode: AuthMode, secret: string): Promise<void>;
  /** Remove a credential. `true` if removed, `false` if it did not exist. */
  delete(provider: string, authMode: AuthMode): Promise<boolean>;
  /** List the decoded, secret-free refs for every credential in the store. */
  list(): Promise<CredentialRef[]>;
}

/**
 * Construction options for `createCredentialStore`. The `backend` is the
 * injected storage seam — in-memory for unit tests, native/env-var-fallback
 * in plan 01-02. `service` is the keychain `service` field (research §6,
 * `swt:<provider>:<authMode>` namespace); it defaults to `'swt'` and is
 * consumed by the native backend factory in plan 01-02.
 */
export interface CredentialStoreOptions {
  readonly backend: CredentialBackend;
  /** Keychain `service` value. Defaults to `'swt'` (see `namespace.ts`). */
  readonly service?: string;
}
