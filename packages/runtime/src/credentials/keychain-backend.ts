/**
 * Phase 1 — Keychain Credential Adapter: the native OS-keychain backend.
 *
 * `createKeychainBackend(service?)` implements {@link CredentialBackend}
 * (from `./types.ts`, plan 01-01) against `@napi-rs/keyring`'s synchronous
 * `Entry(service, account)` API. Risk 1 (Lead risk register) — the library is
 * `@napi-rs/keyring@1.3.0`, an exact-pinned native module.
 *
 * **This file is the ONLY static-import site of `@napi-rs/keyring` in the
 * whole `credentials/` module** — keep the native surface isolated here.
 * `probe.ts` is the only other file that touches the native module, and it
 * uses a *dynamic* `import()` so a missing prebuilt binary degrades gracefully
 * rather than crashing module load.
 *
 * **`listAccounts` is index-backed.** `@napi-rs/keyring`'s `Entry` API has no
 * enumeration primitive, so this backend maintains a secret-FREE account-NAME
 * index inside the keychain itself, under a reserved account `'__swt_index__'`
 * — a JSON array of `<provider>:<authMode>` strings. `setSecret` adds to it,
 * `deleteSecret` removes from it, `listAccounts` reads + parses it. The index
 * holds ONLY account *names*, NEVER secrets, so keeping it in the keychain is
 * safe. A corrupt index JSON degrades to `[]` rather than throwing.
 *
 * **Reserved accounts** `'__swt_index__'` (the index) and `'__swt_probe__'`
 * (used by `probe.ts`) are internal bookkeeping — `listAccounts` filters them
 * out so callers never see them as user credentials.
 *
 * **Actual `@napi-rs/keyring@1.3.0` `Entry` API** (validated against the
 * installed package's `index.d.ts` + a live runtime check):
 *  - `getPassword(): string | null` — returns `null` (NOT a throw) when no
 *    entry exists, so the not-found path is a plain `null` check.
 *  - `setPassword(password: string): void` — synchronous.
 *  - `deletePassword(): boolean` — returns `false` (NOT a throw) when no entry
 *    exists; `true` when an entry was removed.
 * All `Entry` methods are synchronous; the `async` wrapper here satisfies the
 * async {@link CredentialBackend} contract (an `async` fn auto-wraps the sync
 * return in a promise). A genuine *platform* error (locked keychain, Secret
 * Service down) still throws — those propagate, as they should.
 */

import { Entry } from '@napi-rs/keyring';

import { SWT_KEYCHAIN_SERVICE } from './namespace.js';
import type { CredentialBackend } from './types.js';

/** Reserved account holding the secret-free `listAccounts` index. */
const INDEX_ACCOUNT = '__swt_index__';
/** Reserved account used by `probe.ts` for the non-destructive round-trip. */
const PROBE_ACCOUNT = '__swt_probe__';
/** Reserved accounts excluded from `listAccounts` — internal bookkeeping. */
const RESERVED_ACCOUNTS: ReadonlySet<string> = new Set([INDEX_ACCOUNT, PROBE_ACCOUNT]);

/**
 * Build a {@link CredentialBackend} backed by the OS keychain via
 * `@napi-rs/keyring`.
 *
 * @param service - the keychain `service` field; defaults to
 *   {@link SWT_KEYCHAIN_SERVICE} (`'swt'`). The full namespace is
 *   `swt:<provider>:<authMode>` — `service` is the fixed first half, `account`
 *   the encoded `<provider>:<authMode>` second half (see `namespace.ts`).
 */
export function createKeychainBackend(
  service: string = SWT_KEYCHAIN_SERVICE,
): CredentialBackend {
  /** Read + JSON-parse the account-name index; a missing or corrupt index
   *  degrades to `[]` rather than throwing. */
  function readIndex(): string[] {
    const raw = new Entry(service, INDEX_ACCOUNT).getPassword();
    if (raw == null || raw.length === 0) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      // Corrupt index JSON — degrade to empty rather than throw. The index is
      // pure bookkeeping; a corrupt one must never break get/set/delete.
      return [];
    }
  }

  /** Overwrite the account-name index with `accounts` (deduped). */
  function writeIndex(accounts: readonly string[]): void {
    const deduped = [...new Set(accounts)];
    new Entry(service, INDEX_ACCOUNT).setPassword(JSON.stringify(deduped));
  }

  return {
    async getSecret(account: string): Promise<string | undefined> {
      // `@napi-rs/keyring@1.3.0` `Entry.getPassword()` returns `null` (not a
      // throw) when no entry exists — a missing entry is a normal `undefined`,
      // mirroring the in-memory backend's contract. A genuine platform error
      // still throws and propagates.
      const value = new Entry(service, account).getPassword();
      return value == null ? undefined : value;
    },

    async setSecret(account: string, secret: string): Promise<void> {
      new Entry(service, account).setPassword(secret);
      // Maintain the secret-free account-name index. Reserved accounts are
      // bookkeeping and must never be indexed as user credentials.
      if (!RESERVED_ACCOUNTS.has(account)) {
        const index = readIndex();
        if (!index.includes(account)) {
          writeIndex([...index, account]);
        }
      }
    },

    async deleteSecret(account: string): Promise<boolean> {
      // `Entry.deletePassword()` returns `false` (not a throw) when no entry
      // exists, `true` when one was removed.
      const removed = new Entry(service, account).deletePassword();
      if (removed && !RESERVED_ACCOUNTS.has(account)) {
        const index = readIndex();
        if (index.includes(account)) {
          writeIndex(index.filter((a) => a !== account));
        }
      }
      return removed;
    },

    async listAccounts(): Promise<string[]> {
      // Index-backed: `@napi-rs/keyring`'s `Entry` API has no enumeration
      // primitive. Reserved `__swt_*` accounts are filtered out — they are
      // internal bookkeeping, not user credentials.
      return readIndex().filter((account) => !RESERVED_ACCOUNTS.has(account));
    },
  };
}
