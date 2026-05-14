import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { resolveCredentialStore } from '@swt-labs/runtime';
import {
  PROVIDER_VOCABULARY,
  ProviderAuthSnapshotSchema,
  ProviderAuthUpdateBodySchema,
  type ProviderAuthMode,
  type ProviderAuthSnapshot,
  type ProviderAuthStatus,
  type ProviderAuthUpdateResponse,
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
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
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
  const cfgPath = join(cwd, PLANNING_DIR, CONFIG_FILENAME);

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

  /**
   * POST /api/provider-auth — the credential-WRITE route.
   *
   * RISK 7 — gated by BOTH:
   *   1. the per-boot `Bearer` token, already enforced by the `requireToken`
   *      middleware on every `/api/*` request (wired in `server/index.ts` —
   *      NOT re-implemented here); AND
   *   2. an explicit `X-SWT-Credential-Write: confirm` request header THIS
   *      handler checks — if absent or not exactly `'confirm'`, the route
   *      returns 403 BEFORE touching the body, the keychain, or the config.
   *
   * `config.ts:88-91` deliberately declined `DashboardPermissionGate` for
   * plain config edits because that gate is keyed to active vibe-session
   * agent-mediated approvals — meaningless for a direct user button-click,
   * and a credential-write is still a direct user action, not an agent
   * action. But `config.ts`'s "localhost + user-initiated is enough"
   * reasoning was written for a NON-secret file; a credential-WRITE route is
   * a higher bar (research §6 — an attacker on the loopback port holding the
   * token could otherwise swap in their own key). So this handler adds the
   * `X-SWT-Credential-Write` header as a cheap confused-deputy / CSRF-style
   * mitigation — a drive-by or cross-origin request with the token still
   * won't carry the custom header. It is deliberately still NOT the full
   * `DashboardPermissionGate`. The loopback-only binding stays the primary
   * defense.
   *
   * Handling order: header gate -> body validation -> provider-vocabulary
   * check -> `oauth` -> clean 501 (Phase 4 territory; writes nothing) ->
   * keychain write (api_key path; 409 on keychain-unavailable, BEFORE the
   * config write so a keychain failure leaves config.json untouched) ->
   * atomic config write (preserving every other key) -> `state.changed` SSE
   * publish -> respond with a freshly-built, secret-free snapshot.
   */
  app.post('/api/provider-auth', async (c) => {
    // 1. Confirmation-header gate (Risk 7). Checked BEFORE the body, the
    //    keychain, and the config — nothing happens without it.
    const confirm = c.req.header('x-swt-credential-write');
    if (confirm !== 'confirm') {
      return c.json(
        {
          error: 'credential_write_confirmation_required',
          detail: 'POST /api/provider-auth requires the X-SWT-Credential-Write: confirm header.',
        },
        403,
      );
    }

    // 2. Body validation against the 03-01 shared schema (`.strict()`).
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = ProviderAuthUpdateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_provider_auth_body', detail: parsed.error.flatten() }, 400);
    }
    const { provider, authMode } = parsed.data;

    // 3. Provider must be in the canonical vocabulary.
    if (!(PROVIDER_VOCABULARY as readonly string[]).includes(provider)) {
      return c.json({ error: 'unknown_provider', detail: provider }, 400);
    }

    // 4. `oauth` is Phase 4 territory — refuse cleanly, write NOTHING.
    if (authMode === 'oauth') {
      return c.json(
        {
          error: 'oauth_not_yet_supported',
          detail: 'OAuth login lands in a future release.',
        },
        501,
      );
    }

    // 5/6. Keychain write — `api_key` path. With an `apiKey`: write it to the
    // keychain. Without one (re-selection keeping the existing entry): skip
    // the keychain write entirely. CRUCIAL: the keychain write happens BEFORE
    // the config write, so a keychain failure leaves config.json untouched.
    if (parsed.data.apiKey !== undefined) {
      const { store } = await resolveCredentialStore();
      // The secret lives in this local `const` for exactly the duration of
      // the one `store.set()` call below. It is NEVER logged, NEVER put in a
      // response or an error message, and NEVER written to config.json.
      const apiKey = parsed.data.apiKey;
      try {
        await store.set(provider, 'api_key', apiKey);
      } catch (err) {
        // Phase 1's env-fallback backend's `set` rejects with a clear
        // "Keychain unavailable on this host — ..." message when the OS
        // keychain is unavailable (headless / CI / SSH). Surface it as 409;
        // config.json is left untouched.
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: 'keychain_unavailable', detail: message }, 409);
      }
    }

    // 7. Config write — atomic, preserving every other key (mirrors
    //    config.ts: read current, mutate a copy, `mkdir -p` + `writeFile`).
    let config: Record<string, unknown>;
    try {
      const current = await readFile(cfgPath, 'utf8');
      const parsedCurrent: unknown = JSON.parse(current);
      config =
        typeof parsedCurrent === 'object' && parsedCurrent !== null
          ? { ...(parsedCurrent as Record<string, unknown>) }
          : {};
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
        // Greenfield daemon — no config.json yet. Start from an empty object;
        // `mkdir -p` below creates `.swt-planning/` on demand.
        config = {};
      } else {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: 'provider_auth_write_failed', detail: message }, 500);
      }
    }

    const prevProviders =
      typeof config['providers'] === 'object' && config['providers'] !== null
        ? (config['providers'] as Record<string, unknown>)
        : {};
    const prevAuth =
      typeof config['auth'] === 'object' && config['auth'] !== null
        ? (config['auth'] as Record<string, unknown>)
        : {};
    config['providers'] = {
      ...prevProviders,
      strategy: { kind: 'pinned', provider },
    };
    config['auth'] = {
      ...prevAuth,
      // The global `swt:<provider>:<authMode>` credentialRef NAME — Phase 2
      // Risk 3's fixed naming. ONLY the name is persisted; never the secret.
      [provider]: { mode: 'api_key', credentialRef: `swt:${provider}:api_key` },
    };

    try {
      await mkdir(dirname(cfgPath), { recursive: true });
      await writeFile(cfgPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'provider_auth_write_failed', detail: message }, 500);
    }

    // 8. Publish `state.changed` so the panel + other tabs refetch.
    //    NOTE: the `changed` enum in `@swt-labs/shared`'s `StateChangedEvent`
    //    is `['phase','agents','artifacts','cost','config']` — it does not
    //    include a `'provider-auth'` member, and this plan must not change
    //    `packages/shared/**`. `['config']` is a schema-valid subset that
    //    still triggers a refetch (the panel reads config-derived state),
    //    mirroring exactly what `config.ts` publishes.
    if (bus !== undefined) {
      bus.publish({
        type: 'state.changed',
        ts: new Date().toISOString(),
        changed: ['config'],
        snapshot: {},
      });
    }

    // 9. Respond with a freshly-built snapshot — secret-free by 03-01's
    //    `ProviderAuthSnapshotSchema` construction. The `apiKey` never
    //    appears here.
    let snapshot: ProviderAuthSnapshot;
    try {
      snapshot = await buildSnapshot(cwd);
      ProviderAuthSnapshotSchema.parse(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'provider_auth_read_failed', detail: message }, 500);
    }
    const response: ProviderAuthUpdateResponse = {
      ok: true,
      snapshot,
      generated_at: new Date().toISOString(),
    };
    return c.json(response);
  });
}
