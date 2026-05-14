/**
 * Phase 1 — Keychain Credential Adapter: the in-memory reference backend.
 *
 * A `Map`-backed implementation of {@link CredentialBackend} — the backend
 * ALL Phase 1 unit tests run against. CI never touches a real OS keychain
 * (it would prompt, or fail on headless runners — ROADMAP constraint), so the
 * codec layer (`credential-store.ts`) is exercised entirely through this
 * pure, native-dep-free backend. It is also reusable by the `runtime` mock
 * spawner environment.
 *
 * No IO, no native deps — `seed` and `snapshot()` make backend state fully
 * inspectable from tests without reaching into internals.
 */

import type { CredentialBackend } from './types.js';

/**
 * Build a `Map`-backed {@link CredentialBackend} for unit tests and the mock
 * spawner environment.
 *
 * @param seed - Optional pre-population, keyed by ALREADY-ENCODED account
 *   strings (e.g. `{ 'openai:api_key': 'sk-test' }`) — the same `account`
 *   shape `namespace.ts:encodeAccount` produces. A shallow copy is taken, so
 *   later mutations of `seed` do not leak into the backend.
 * @returns the backend, plus a `snapshot()` test-affordance — a plain-object
 *   copy of the current map so tests can assert backend state without
 *   touching internals. The methods are `async` to satisfy
 *   {@link CredentialBackend} (the real keychain backend in plan 01-02 is
 *   genuinely async).
 */
export function createInMemoryBackend(
  seed?: Record<string, string>,
): CredentialBackend & { snapshot(): Record<string, string> } {
  const store = new Map<string, string>(seed ? Object.entries(seed) : []);
  return {
    async getSecret(account: string): Promise<string | undefined> {
      return store.get(account);
    },
    async setSecret(account: string, secret: string): Promise<void> {
      store.set(account, secret);
    },
    async deleteSecret(account: string): Promise<boolean> {
      return store.delete(account);
    },
    async listAccounts(): Promise<string[]> {
      return [...store.keys()];
    },
    snapshot(): Record<string, string> {
      return Object.fromEntries(store);
    },
  };
}
