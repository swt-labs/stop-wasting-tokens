import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveCredentialStore } from '@swt-labs/runtime';
import {
  PROVIDER_VOCABULARY,
  ProviderAuthSnapshotSchema,
  type ProviderAuthMode,
  type ProviderAuthSnapshot,
  type ProviderAuthStatus,
} from '@swt-labs/shared';
import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';

/**
 * Phase 3 — the dashboard vendor-select panel's server half:
 * `GET/POST /api/provider-auth`.
 *
 * This route MIRRORS `config.ts`'s shape — `registerXRoute(app, cwd, bus?)`,
 * the `.swt-planning/config.json` read/parse/ENOENT-fallback, the atomic
 * `mkdir -p` + `writeFile`, the `state.changed` SSE publish, the
 * `c.json({error, detail}, status)` envelopes — but adds the credential-write
 * specifics.
 *
 * WRITE-ONLY-SECRET INVARIANT (load-bearing — research §6, 03-OVERVIEW):
 *   - `GET` returns the *selection* + per-provider auth *status* only — never
 *     a secret value. It validates its own response against
 *     `ProviderAuthSnapshotSchema` before sending, so a regression that adds
 *     a secret-shaped field fails fast.
 *   - `POST` accepts the `apiKey` secret exactly once (inbound only). The
 *     secret lives in a local `const` for the duration of one
 *     `store.set()` call and is NEVER logged (no `console.*`), NEVER put in a
 *     response body or an error message, and NEVER written to
 *     `.swt-planning/config.json` — only the non-secret `credentialRef` NAME
 *     (`swt:<provider>:api_key`) is persisted there.
 *
 * RISK 6 — the route hard-depends on `@swt-labs/runtime`'s
 * `resolveCredentialStore`. A working OS-keychain binding over the native
 * `@napi-rs/keyring` module cannot be "mirrored" the way the dashboard mirrors
 * small enum slices. It is a normal downward dependency (dashboard server L7,
 * `runtime` L2); standalone-tarball-safe because `@napi-rs/keyring`'s platform
 * binaries are `runtime`'s `optionalDependencies` with prebuilt coverage and
 * `probeKeychain`'s dynamic import degrades a missing binary to the env
 * fallback instead of crashing.
 *
 * RISK 7 — the `POST` (credential-write) handler is gated by BOTH the per-boot
 * `Bearer` token (the `requireToken` middleware, wired in `server/index.ts`)
 * AND an explicit `X-SWT-Credential-Write: confirm` request header this route
 * checks. See the `POST` handler JSDoc for the full rationale.
 *
 * No `@swt-labs/cli` dependency: the `providers.strategy` + `auth` config
 * shapes are read defensively inline (an L7->L6 import would be a layering
 * violation — `cli` is not a dashboard dependency).
 */

const PLANNING_DIR = '.swt-planning';
const CONFIG_FILENAME = 'config.json';

/** The `auth.<provider>` sub-object shape this route reads/writes — a defensive
 *  inline mirror of Phase 2's `parseAuthConfig` discipline (drop entries with
 *  a bad `mode`). */
interface AuthBlockEntry {
  mode: ProviderAuthMode;
  credentialRef?: string;
}

/**
 * Defensively extract the current provider selection from a parsed config's
 * `providers.strategy` block (Phase 2's `parseProvidersConfig` shape) without
 * importing `@swt-labs/cli`. When `strategy.kind === 'pinned'` the pinned
 * `provider` is the selection; any other kind (or a missing/malformed block)
 * means no single provider is pinned.
 */
function extractSelection(parsed: unknown): {
  selected_provider: string | null;
  strategy_kind: string;
} {
  if (typeof parsed !== 'object' || parsed === null) {
    return { selected_provider: null, strategy_kind: 'pinned' };
  }
  const providers = (parsed as { providers?: unknown }).providers;
  if (typeof providers !== 'object' || providers === null) {
    return { selected_provider: null, strategy_kind: 'pinned' };
  }
  const strategy = (providers as { strategy?: unknown }).strategy;
  if (typeof strategy !== 'object' || strategy === null) {
    return { selected_provider: null, strategy_kind: 'pinned' };
  }
  const kind = (strategy as { kind?: unknown }).kind;
  const kindStr = typeof kind === 'string' ? kind : 'pinned';
  if (kindStr === 'pinned') {
    const provider = (strategy as { provider?: unknown }).provider;
    return {
      selected_provider: typeof provider === 'string' && provider.length > 0 ? provider : null,
      strategy_kind: 'pinned',
    };
  }
  return { selected_provider: null, strategy_kind: kindStr };
}

/**
 * Defensively parse the `auth` block (a `Record<string, {mode, credentialRef?}>`)
 * from a parsed config, mirroring Phase 2's `parseAuthConfig` discipline: skip
 * any entry whose `mode` is not a valid `ProviderAuthMode`. No `@swt-labs/cli`
 * import — the shape is small and read defensively inline.
 */
function extractAuthBlock(parsed: unknown): Record<string, AuthBlockEntry> {
  const out: Record<string, AuthBlockEntry> = {};
  if (typeof parsed !== 'object' || parsed === null) return out;
  const auth = (parsed as { auth?: unknown }).auth;
  if (typeof auth !== 'object' || auth === null) return out;
  for (const [provider, rawEntry] of Object.entries(auth as Record<string, unknown>)) {
    if (typeof rawEntry !== 'object' || rawEntry === null) continue;
    const mode = (rawEntry as { mode?: unknown }).mode;
    if (mode !== 'api_key' && mode !== 'oauth') continue;
    const credentialRef = (rawEntry as { credentialRef?: unknown }).credentialRef;
    out[provider] = {
      mode,
      ...(typeof credentialRef === 'string' ? { credentialRef } : {}),
    };
  }
  return out;
}

/**
 * Build the secret-free `ProviderAuthSnapshot` both `GET` and `POST` return:
 * the current selection (from `providers.strategy`), per-provider auth status
 * (from `resolveCredentialStore` — keychain or env fallback), and keychain
 * availability (from the probe result).
 *
 * Reads `.swt-planning/config.json`; ENOENT is treated as greenfield
 * (`selected_provider: null`, `strategy_kind: 'pinned'`, no `auth` block) — the
 * keychain probe still runs so the panel can render its availability banner.
 * Malformed JSON throws; the `GET` handler maps that to a 500.
 *
 * NEVER includes a secret: each `ProviderAuthStatus` carries only
 * `provider`/`configured`/`mode`/`source`/`label`.
 */
async function buildSnapshot(cwd: string): Promise<ProviderAuthSnapshot> {
  const cfgPath = join(cwd, PLANNING_DIR, CONFIG_FILENAME);

  let parsed: unknown = {};
  try {
    const raw = await readFile(cfgPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      // Greenfield daemon — no `.swt-planning/config.json` yet. Fall through
      // with `parsed = {}`: the selection defaults to null/pinned and the
      // `auth` block is empty, but the keychain probe below still runs.
      parsed = {};
    } else {
      // Malformed JSON (or any other read error) — surface it. The `GET`
      // handler catches this and returns a 500 (mirrors config.ts).
      throw err;
    }
  }

  const { selected_provider, strategy_kind } = extractSelection(parsed);
  const authBlock = extractAuthBlock(parsed);

  // Resolve the credential store ONCE — both for the probe result and to
  // read per-provider `configured` status.
  const resolved = await resolveCredentialStore();
  const keychain_available = resolved.probe.available;
  const keychain_reason = resolved.probe.reason ?? null;
  const backendKind = resolved.backend; // 'keychain' | 'env-fallback'

  const statuses: ProviderAuthStatus[] = [];
  for (const provider of PROVIDER_VOCABULARY) {
    const mode: ProviderAuthMode | null = authBlock[provider]?.mode ?? null;
    let configured = false;
    try {
      // `store.get` resolves the secret value; we read only its presence +
      // length, never the value itself.
      const value = await resolved.store.get(provider, mode ?? 'api_key');
      configured = value !== undefined && value.length > 0;
    } catch {
      // One provider's keychain read failing must not break the whole
      // snapshot — treat it as "not configured" and move on. No console.*.
      configured = false;
    }
    const source: 'keychain' | 'env' | null = configured
      ? backendKind === 'keychain'
        ? 'keychain'
        : 'env'
      : null;
    const label: string | null = configured
      ? backendKind === 'keychain'
        ? 'Keychain'
        : `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
      : null;
    statuses.push({ provider, configured, mode, source, label });
  }

  return {
    selected_provider,
    strategy_kind,
    keychain_available,
    keychain_reason,
    statuses,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Registers `GET /api/provider-auth` (secret-free snapshot) and
 * `POST /api/provider-auth` (keychain write + config write, Risk-7 gated).
 *
 * Mirrors `registerConfigRoute`'s signature + mounting pattern. Mounted in
 * `createApp` right after `registerConfigRoute` so the per-boot `Bearer`
 * token middleware (already wired on `/api/*`) covers both routes.
 */
export function registerProviderAuthRoute(app: Hono, cwd: string, bus?: EventBus): void {
  // `bus` is consumed by the POST handler (added in 03-02-T3) to publish a
  // `state.changed` SSE event after a successful credential/config write.
  void bus;

  /**
   * GET /api/provider-auth — the secret-free provider-auth snapshot.
   *
   * Gated by the EXISTING per-boot `Bearer` token middleware only: it is
   * read-only and secret-free, so it needs no extra confirmation header
   * (unlike `POST`). The handler validates its own response against
   * `ProviderAuthSnapshotSchema` before sending — a defensive trip-wire so a
   * regression that leaks a secret-shaped field fails fast with a 500 rather
   * than reaching the client.
   */
  app.get('/api/provider-auth', async (c) => {
    let snapshot: ProviderAuthSnapshot;
    try {
      snapshot = await buildSnapshot(cwd);
      // Defensive: re-validate the shape we built. If a future change ever
      // adds a secret-carrying field, `.parse` throws here and we 500
      // instead of shipping it.
      ProviderAuthSnapshotSchema.parse(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'provider_auth_read_failed', detail: message }, 500);
    }
    return c.json(snapshot);
  });
}
