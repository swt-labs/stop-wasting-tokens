import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  runOAuthLoginFlow,
  storeOAuthCredentials,
  getOAuthProvider,
  type OAuthLoginFlowHandle,
} from '@swt-labs/runtime';
import {
  OAuthStartBodySchema,
  OAuthManualCodeBodySchema,
  OAuthStartResponseSchema,
  OAuthManualCodeResponseSchema,
  OAuthAuthUrlEventSchema,
  OAuthProgressEventSchema,
  OAuthAwaitingCodeEventSchema,
  OAuthCompleteEventSchema,
  OAuthErrorEventSchema,
  type SnapshotEvent,
} from '@swt-labs/shared';
import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';

/**
 * Phase 4 — the dashboard's OAuth login server half:
 * `POST /api/provider-auth/oauth/start` + `POST /api/provider-auth/oauth/code`.
 *
 * SWT does NOT build OAuth. `@earendil-works/pi-ai` ships the complete OAuth
 * subsystem — and critically, `pi-ai`'s `login()` runs its OWN
 * `http.createServer` loopback callback server (research §1 / §5 —
 * `anthropic.d.ts` / `openai-codex.d.ts` headers). So SWT does NOT host a
 * separate `/auth/callback` route: the dashboard Hono server hosts only the
 * `start` route (kicks off the flow) and the `code` route (the Risk-4
 * headless manual-code paste bridge); `pi-ai` owns the loopback callback.
 *
 * TOKEN-FREE INVARIANT (load-bearing — research §6, 04-OVERVIEW Scope
 * Boundary): no `OAuthCredentials` blob, no `access` / `refresh` token, EVER
 * reaches an SSE event payload, a route response body, a log line, or
 * `.swt-planning/`. The `oauth.*` events carry only `flow_id` / `provider` /
 * `url` / `message` / error-`code` strings. The blob flows from `pi-ai`'s
 * `login()` straight into `storeOAuthCredentials` → the OS keychain; only the
 * non-secret `credentialRef` NAME (`swt:<provider>:oauth`) is persisted to
 * `config.json`.
 *
 * RISK 7 — both routes are credential-WRITE operations (starting an OAuth
 * flow culminates in a keychain write). They are gated by BOTH the per-boot
 * `Bearer` token (the `requireToken` middleware, already covering `/api/*` —
 * NOT re-implemented here) AND the explicit `X-SWT-Credential-Write: confirm`
 * request header Phase 3-02 established for `POST /api/provider-auth`. The
 * OAuth routes are siblings of that API-key route under the same model.
 *
 * RISK 4 — `onManualCodeInput` is bridged over the same SSE channel: when
 * `pi-ai`'s `login()` invokes `onManualCodeInput()` the driver fires
 * `onAwaitingCode` (→ this route publishes `oauth.awaiting_code`) and returns
 * a promise this route resolves when the user POSTs the pasted code to
 * `/oauth/code`. Flows are keyed by a server-generated `flowId` so concurrent
 * flows never cross-wire.
 *
 * No `@swt-labs/cli` dependency: the `auth` config block is read/written
 * defensively inline (an L7→L6 import would be a layering violation). The
 * OAuth-flow driver + the keychain helper live in `@swt-labs/runtime` (L2),
 * consumed through the existing dashboard→runtime edge — no
 * `@earendil-works/pi-ai` dependency is added to the dashboard.
 */

const PLANNING_DIR = '.swt-planning';
const CONFIG_FILENAME = 'config.json';

/** In-flight OAuth flow state — held in the per-`createApp` registry while a
 *  flow's `login()` is running (the browser round-trip). */
interface OAuthFlowState {
  provider: string;
  /** The driver handle — `submitManualCode` feeds the Risk-4 paste. */
  handle: OAuthLoginFlowHandle;
  /** `true` while `pi-ai`'s `login()` is parked awaiting a manual code. */
  awaitingCode: boolean;
}

/**
 * Atomically update `.swt-planning/config.json` so `auth.<provider>` names
 * the OAuth credentialRef — read current, mutate a copy, `mkdir -p` +
 * `writeFile`, preserving every other key. Mirrors Phase 3-02's
 * `provider-auth.ts` config-write discipline. ONLY the non-secret
 * `credentialRef` NAME is persisted — never the `OAuthCredentials` blob.
 */
async function writeAuthConfig(cfgPath: string, provider: string): Promise<void> {
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
      // Greenfield daemon — no config.json yet; `mkdir -p` below creates
      // `.swt-planning/` on demand.
      config = {};
    } else {
      throw err;
    }
  }

  const prevAuth =
    typeof config['auth'] === 'object' && config['auth'] !== null
      ? (config['auth'] as Record<string, unknown>)
      : {};
  config['auth'] = {
    ...prevAuth,
    // The fixed `swt:<provider>:oauth` credentialRef NAME (Phase 2 Risk 3
    // naming). ONLY the name is persisted; never the OAuthCredentials blob.
    [provider]: { mode: 'oauth', credentialRef: `swt:${provider}:oauth` },
  };

  await mkdir(dirname(cfgPath), { recursive: true });
  await writeFile(cfgPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * Registers `POST /api/provider-auth/oauth/start` (kicks off
 * `runOAuthLoginFlow` in the background, bridges its `OAuthLoginCallbacks`
 * onto `oauth.*` SSE events, on complete writes the blob to the keychain +
 * atomically updates the `auth` config block + publishes `state.changed`) and
 * `POST /api/provider-auth/oauth/code` (the Risk-4 manual-code paste bridge).
 *
 * Mirrors `registerProviderAuthRoute`'s `registerXRoute(app, cwd, bus)`
 * signature. Mounted in `createApp` right after `registerProviderAuthRoute`
 * so the per-boot `Bearer` token middleware (already wired on `/api/*`)
 * covers both OAuth routes automatically.
 */
export function registerProviderAuthOAuthRoute(app: Hono, cwd: string, bus: EventBus): void {
  const cfgPath = join(cwd, PLANNING_DIR, CONFIG_FILENAME);

  // The in-process flow registry — per `createApp`, so each daemon instance
  // (and each test's freshly-registered route) gets its own.
  const flows = new Map<string, OAuthFlowState>();

  /**
   * Publish an `oauth.*` `SnapshotEvent` onto the bus, validating it against
   * the matching `*EventSchema` first (defensive — mirrors Phase 3-02's
   * snapshot self-validation; a regression that ever put a token-shaped field
   * on an `oauth.*` event would throw here instead of reaching the SSE wire).
   */
  function publishOAuthEvent(event: SnapshotEvent): void {
    switch (event.type) {
      case 'oauth.auth_url':
        OAuthAuthUrlEventSchema.parse(event);
        break;
      case 'oauth.progress':
        OAuthProgressEventSchema.parse(event);
        break;
      case 'oauth.awaiting_code':
        OAuthAwaitingCodeEventSchema.parse(event);
        break;
      case 'oauth.complete':
        OAuthCompleteEventSchema.parse(event);
        break;
      case 'oauth.error':
        OAuthErrorEventSchema.parse(event);
        break;
      default:
        // Not an oauth.* event — should never happen from this route.
        break;
    }
    bus.publish(event);
  }

  /**
   * POST /api/provider-auth/oauth/start — kick off an OAuth login flow.
   *
   * Handling order: header gate → body validation → supported-provider check
   * → generate `flowId` + register the flow → kick off `runOAuthLoginFlow` in
   * the background (its callbacks publish `oauth.*` SSE events; `onComplete`
   * writes the keychain + the config + publishes `state.changed`) → respond
   * immediately with the `flow_id`. The flow continues in the background; the
   * SPA tracks it via the `oauth.*` SSE events keyed by `flow_id`.
   */
  app.post('/api/provider-auth/oauth/start', async (c) => {
    // 1. Confirmation-header gate (Risk 7) — checked BEFORE the body, the
    //    driver, the keychain, and the config.
    const confirm = c.req.header('x-swt-credential-write');
    if (confirm !== 'confirm') {
      return c.json(
        {
          error: 'credential_write_confirmation_required',
          detail:
            'POST /api/provider-auth/oauth/start requires the X-SWT-Credential-Write: confirm header.',
        },
        403,
      );
    }

    // 2. Body validation against the 04-01 shared schema (`.strict()`).
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = OAuthStartBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_oauth_start_body', detail: parsed.error.flatten() }, 400);
    }
    const { provider } = parsed.data;

    // 3. Supported-provider check — `getOAuthProvider` (re-exported by
    //    `@swt-labs/runtime` from `pi-ai`) is `undefined` for a provider with
    //    no `pi-ai` OAuth implementation. Reject up front with a clean signal.
    if (getOAuthProvider(provider) === undefined) {
      return c.json({ error: 'oauth_provider_unsupported', detail: provider }, 400);
    }

    // 4. Generate a non-guessable correlator + register the flow.
    const flowId = randomUUID();
    const ts = (): string => new Date().toISOString();

    // 5. Kick off the driver WITHOUT awaiting — the flow is long-running (the
    //    browser round-trip). The callbacks below are closures over
    //    `flowId` / `provider` / `bus` / `cfgPath` / `flows`.
    const handle = runOAuthLoginFlow({
      provider,
      flowId,
      onAuthUrl: (url, instructions) => {
        publishOAuthEvent({
          type: 'oauth.auth_url',
          ts: ts(),
          flow_id: flowId,
          provider,
          url,
          ...(instructions !== undefined ? { instructions } : {}),
        });
      },
      onProgress: (message) => {
        publishOAuthEvent({
          type: 'oauth.progress',
          ts: ts(),
          flow_id: flowId,
          provider,
          message,
        });
      },
      onAwaitingCode: (message) => {
        const flow = flows.get(flowId);
        if (flow) flow.awaitingCode = true;
        publishOAuthEvent({
          type: 'oauth.awaiting_code',
          ts: ts(),
          flow_id: flowId,
          provider,
          ...(message !== undefined ? { message } : {}),
        });
      },
      onComplete: async (credentials) => {
        // Ordering matters (04-02 Decisions): the keychain write happens
        // BEFORE the config write + the `oauth.complete` event. If
        // `storeOAuthCredentials` rejects (headless host / keychain
        // unavailable) we publish `oauth.error` and write NOTHING to
        // config.json — the `auth.<provider>` block must never name a
        // credentialRef with no keychain entry behind it.
        try {
          await storeOAuthCredentials(provider, credentials);
          await writeAuthConfig(cfgPath, provider);
          publishOAuthEvent({
            type: 'oauth.complete',
            ts: ts(),
            flow_id: flowId,
            provider,
          });
          // `state.changed` so the panel's `providerAuth` cell + other tabs
          // refetch. The `changed` enum has no `'provider-auth'` member and
          // this plan must not change `packages/shared/**`; `['config']` is a
          // schema-valid subset that still triggers the refetch (mirrors
          // Phase 3-02's `provider-auth.ts`).
          bus.publish({
            type: 'state.changed',
            ts: ts(),
            changed: ['config'],
            snapshot: {},
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          publishOAuthEvent({
            type: 'oauth.error',
            ts: ts(),
            flow_id: flowId,
            provider,
            code: 'keychain_unavailable',
            message,
          });
        } finally {
          flows.delete(flowId);
        }
      },
      onError: (code, message) => {
        publishOAuthEvent({
          type: 'oauth.error',
          ts: ts(),
          flow_id: flowId,
          provider,
          code,
          message,
        });
        flows.delete(flowId);
      },
    });

    // 6. Register the flow AFTER kicking off the driver — the callbacks above
    //    look the flow up by `flowId`, and a synchronous `onError` (e.g.
    //    unsupported provider, though that is already screened at step 3)
    //    would `flows.delete` a not-yet-set entry, which is a harmless no-op.
    flows.set(flowId, { provider, handle, awaitingCode: false });

    // 7. Respond immediately — the flow continues in the background.
    const response = {
      ok: true as const,
      flow_id: flowId,
      provider,
      started_at: new Date().toISOString(),
    };
    OAuthStartResponseSchema.parse(response);
    return c.json(response);
  });

  /**
   * POST /api/provider-auth/oauth/code — the Risk-4 manual-code paste bridge.
   *
   * Feeds a user-pasted authorization code into a running flow that is
   * awaiting one. The login completion still arrives via the
   * `oauth.complete` / `oauth.error` SSE event — this route only acknowledges
   * that the code was accepted into the flow. The `code` string lives in a
   * local for exactly the duration of the `submitManualCode(code)` call: it
   * is NEVER logged, NEVER stored, NEVER in the response.
   */
  app.post('/api/provider-auth/oauth/code', async (c) => {
    // 1. Same Risk-7 gate — this route feeds a flow that writes a credential.
    const confirm = c.req.header('x-swt-credential-write');
    if (confirm !== 'confirm') {
      return c.json(
        {
          error: 'credential_write_confirmation_required',
          detail:
            'POST /api/provider-auth/oauth/code requires the X-SWT-Credential-Write: confirm header.',
        },
        403,
      );
    }

    // 2. Body validation against the 04-01 shared schema (`.strict()`).
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = OAuthManualCodeBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_oauth_code_body', detail: parsed.error.flatten() }, 400);
    }

    // 3. Look up the flow — absent means no such flow, or it already
    //    completed/errored.
    const flow = flows.get(parsed.data.flow_id);
    if (!flow) {
      return c.json({ error: 'oauth_flow_not_found' }, 404);
    }

    // 4. The flow must currently be awaiting a manual code.
    if (!flow.awaitingCode) {
      return c.json({ error: 'oauth_flow_not_awaiting_code' }, 409);
    }

    // 5. Feed the pasted code into the running `login()` flow. The `code`
    //    local is used ONLY here — never logged, never stored, never in the
    //    response.
    const code = parsed.data.code;
    flow.handle.submitManualCode(code);
    flow.awaitingCode = false;

    // 6. Acknowledge — the actual completion arrives via the SSE event.
    const response = { ok: true as const, flow_id: parsed.data.flow_id };
    OAuthManualCodeResponseSchema.parse(response);
    return c.json(response);
  });
}
