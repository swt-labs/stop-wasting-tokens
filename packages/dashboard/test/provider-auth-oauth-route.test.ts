import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OAuthStartResponseSchema,
  OAuthManualCodeResponseSchema,
  type SnapshotEvent,
} from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.ts';

/* ── @swt-labs/runtime mock — NO real OAuth flow / browser / network / keychain
 *
 * `provider-auth-oauth.ts` imports three symbols from `@swt-labs/runtime`:
 * `runOAuthLoginFlow`, `storeOAuthCredentials`, `getOAuthProvider` (+ the
 * `OAuthLoginFlowHandle` type). We mock all three:
 *
 *  - `runOAuthLoginFlow` is a controllable fake: it captures the `opts` the
 *    route passes (so the test can drive `opts.onAuthUrl(...)`,
 *    `opts.onAwaitingCode(...)`, `opts.onComplete(...)`, `opts.onError(...)`
 *    AFTER the route kicks it off) and returns a fake handle whose
 *    `submitManualCode` is a `vi.fn()`.
 *  - `storeOAuthCredentials` is a `vi.fn()` — resolves by default, a per-case
 *    variant rejects (the keychain-unavailable path).
 *  - `getOAuthProvider` is a `vi.fn()` returning a truthy fake for supported
 *    providers and `undefined` for unsupported ones.
 *
 * Sentinel token strings (`ACCESS-SENTINEL-9f3a` / `REFRESH-SENTINEL-9f3a`)
 * are used in every fake `OAuthCredentials` blob so the secret-leak guard is
 * unambiguous.
 */

type CapturedOpts = {
  provider: string;
  flowId: string;
  onAuthUrl: (url: string, instructions?: string) => void;
  onProgress: (message: string) => void;
  onAwaitingCode: (message?: string) => void;
  onComplete: (credentials: Record<string, unknown>) => Promise<void> | void;
  onError: (code: string, message: string) => void;
};

// Module-level switches the mock factory reads. Each test resets them in
// `beforeEach` and tweaks them inline.
let lastFlowOpts: CapturedOpts | undefined;
const submitManualCodeFn = vi.fn();
let storeShouldReject = false;
const SUPPORTED_PROVIDERS = new Set(['anthropic', 'openai-codex', 'github-copilot']);

const runOAuthLoginFlowMock = vi.fn((opts: CapturedOpts) => {
  lastFlowOpts = opts;
  return { submitManualCode: submitManualCodeFn };
});
const storeOAuthCredentialsMock = vi.fn(async () => {
  if (storeShouldReject) {
    throw new Error('Keychain unavailable on this host — cannot persist a credential.');
  }
});
const getOAuthProviderMock = vi.fn((id: string) =>
  SUPPORTED_PROVIDERS.has(id) ? { id, name: id } : undefined,
);

// Milestone 21 Phase 01 — the route now calls `mapToOAuthProviderId(provider)`
// before its `getOAuthProvider(...)` check + before passing the id into
// `runOAuthLoginFlow`. Real helper: `openai → openai-codex` + identity
// fallback. Tests in this file post `provider: 'openai-codex' | 'anthropic' |
// 'github-copilot'` (the pi-ai-side ids already; identity-mapped) plus one
// truly-unsupported provider (`'google'`, also identity-mapped). Mocking the
// helper with the same identity-fallback shape keeps every existing assertion
// stable.
const mapToOAuthProviderIdMock = vi.fn((id: string) => (id === 'openai' ? 'openai-codex' : id));

vi.mock('@swt-labs/runtime', () => ({
  runOAuthLoginFlow: runOAuthLoginFlowMock,
  storeOAuthCredentials: storeOAuthCredentialsMock,
  getOAuthProvider: getOAuthProviderMock,
  mapToOAuthProviderId: mapToOAuthProviderIdMock,
}));

// Imported AFTER `vi.mock` is registered (vitest hoists `vi.mock`).
const { registerProviderAuthOAuthRoute } =
  await import('../src/server/routes/provider-auth-oauth.ts');

let cwd: string;
let app: Hono;
let bus: EventBus;
let busListener: ReturnType<typeof vi.fn>;
/** Every event published on the bus across a test — for the secret-leak guard. */
let publishedEvents: SnapshotEvent[];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'swt-provider-auth-oauth-route-'));
  app = new Hono();
  bus = createEventBus();
  publishedEvents = [];
  busListener = vi.fn((e: SnapshotEvent) => {
    publishedEvents.push(e);
  });
  bus.subscribe(busListener);
  lastFlowOpts = undefined;
  storeShouldReject = false;
  runOAuthLoginFlowMock.mockClear();
  storeOAuthCredentialsMock.mockClear();
  getOAuthProviderMock.mockClear();
  submitManualCodeFn.mockClear();
  registerProviderAuthOAuthRoute(app, cwd, bus);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  app = new Hono();
});

const configPath = (): string => join(cwd, '.swt-planning', 'config.json');

async function postStart(
  body: unknown,
  opts: { confirm?: boolean } = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.confirm !== false) headers['X-SWT-Credential-Write'] = 'confirm';
  const res = await app.request('/api/provider-auth/oauth/start', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as unknown, text };
}

async function postCode(
  body: unknown,
  opts: { confirm?: boolean } = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.confirm !== false) headers['X-SWT-Credential-Write'] = 'confirm';
  const res = await app.request('/api/provider-auth/oauth/code', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as unknown, text };
}

/** Let the route's async `onComplete` settle (it awaits the keychain write +
 *  the config write before publishing). */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('POST /api/provider-auth/oauth/start', () => {
  it('returns 403 credential_write_confirmation_required without the X-SWT-Credential-Write header', async () => {
    const { status, body } = await postStart({ provider: 'anthropic' }, { confirm: false });
    expect(status).toBe(403);
    expect((body as { error: string }).error).toBe('credential_write_confirmation_required');
    // The driver was NOT kicked off.
    expect(runOAuthLoginFlowMock).not.toHaveBeenCalled();
  });

  it('returns 200 + a valid OAuthStartResponse and kicks off runOAuthLoginFlow with the header', async () => {
    const { status, body } = await postStart({ provider: 'anthropic' });
    expect(status).toBe(200);
    const parsed = OAuthStartResponseSchema.parse(body);
    expect(parsed.ok).toBe(true);
    expect(parsed.provider).toBe('anthropic');
    // The driver was called once with provider:'anthropic' + a non-empty flowId.
    expect(runOAuthLoginFlowMock).toHaveBeenCalledTimes(1);
    expect(lastFlowOpts?.provider).toBe('anthropic');
    expect(lastFlowOpts?.flowId).toBeTruthy();
    // The response's flow_id matches the flowId handed to the driver.
    expect(parsed.flow_id).toBe(lastFlowOpts?.flowId);
  });

  it('driver onAuthUrl → an oauth.auth_url SSE event with the matching flow_id', async () => {
    const { body } = await postStart({ provider: 'anthropic' });
    const flowId = (body as { flow_id: string }).flow_id;

    lastFlowOpts!.onAuthUrl('https://provider/auth', 'instructions');

    const evt = publishedEvents.find((e) => e.type === 'oauth.auth_url');
    expect(evt).toBeDefined();
    if (evt && evt.type === 'oauth.auth_url') {
      expect(evt.flow_id).toBe(flowId);
      expect(evt.provider).toBe('anthropic');
      expect(evt.url).toBe('https://provider/auth');
    }
  });

  it('driver onComplete → storeOAuthCredentials + oauth.complete + state.changed + config write', async () => {
    await postStart({ provider: 'anthropic' });
    const blob = { refresh: 'REFRESH-SENTINEL-9f3a', access: 'ACCESS-SENTINEL-9f3a', expires: 999 };

    await lastFlowOpts!.onComplete(blob);
    await flush();

    // The keychain helper was called with (provider, blob).
    expect(storeOAuthCredentialsMock).toHaveBeenCalledWith('anthropic', blob);
    // oauth.complete + state.changed both published.
    expect(publishedEvents.some((e) => e.type === 'oauth.complete')).toBe(true);
    expect(publishedEvents.some((e) => e.type === 'state.changed')).toBe(true);
    // config.json now names the OAuth credentialRef.
    expect(existsSync(configPath())).toBe(true);
    const written = JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
    expect(written['auth']).toEqual({
      anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' },
    });
  });

  it('driver onError → an oauth.error SSE event', async () => {
    await postStart({ provider: 'anthropic' });

    lastFlowOpts!.onError('oauth_login_failed', 'boom');

    const evt = publishedEvents.find((e) => e.type === 'oauth.error');
    expect(evt).toBeDefined();
    if (evt && evt.type === 'oauth.error') {
      expect(evt.code).toBe('oauth_login_failed');
      expect(evt.message).toBe('boom');
    }
  });

  it('returns 400 oauth_provider_unsupported for a provider getOAuthProvider does not support', async () => {
    const { status, body } = await postStart({ provider: 'google' });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('oauth_provider_unsupported');
    // The driver was NOT kicked off for an unsupported provider.
    expect(runOAuthLoginFlowMock).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_oauth_start_body for an invalid body (.strict violation / missing provider)', async () => {
    const missing = await postStart({});
    expect(missing.status).toBe(400);
    expect((missing.body as { error: string }).error).toBe('invalid_oauth_start_body');

    const extra = await postStart({ provider: 'anthropic', extra: 'x' });
    expect(extra.status).toBe(400);
    expect((extra.body as { error: string }).error).toBe('invalid_oauth_start_body');
  });

  it('keychain-unavailable on complete → oauth.error (code: keychain_unavailable), config NOT written', async () => {
    storeShouldReject = true;
    await postStart({ provider: 'anthropic' });
    const blob = { refresh: 'REFRESH-SENTINEL-9f3a', access: 'ACCESS-SENTINEL-9f3a', expires: 1 };

    await lastFlowOpts!.onComplete(blob);
    await flush();

    const errEvt = publishedEvents.find((e) => e.type === 'oauth.error');
    expect(errEvt).toBeDefined();
    if (errEvt && errEvt.type === 'oauth.error') {
      expect(errEvt.code).toBe('keychain_unavailable');
    }
    // NO oauth.complete, and config.json was NOT written.
    expect(publishedEvents.some((e) => e.type === 'oauth.complete')).toBe(false);
    expect(existsSync(configPath())).toBe(false);
  });
});

describe('POST /api/provider-auth/oauth/code', () => {
  it('returns 403 without the X-SWT-Credential-Write header', async () => {
    const { status, body } = await postCode(
      { flow_id: 'whatever', code: 'abc' },
      { confirm: false },
    );
    expect(status).toBe(403);
    expect((body as { error: string }).error).toBe('credential_write_confirmation_required');
  });

  it('returns 404 oauth_flow_not_found for an unknown flow_id', async () => {
    const { status, body } = await postCode({ flow_id: 'no-such-flow', code: 'abc' });
    expect(status).toBe(404);
    expect((body as { error: string }).error).toBe('oauth_flow_not_found');
  });

  it('returns 409 oauth_flow_not_awaiting_code for a flow that exists but is not awaiting a code', async () => {
    const { body } = await postStart({ provider: 'anthropic' });
    const flowId = (body as { flow_id: string }).flow_id;
    // The flow exists but onAwaitingCode was never driven.
    const { status, body: codeBody } = await postCode({ flow_id: flowId, code: 'abc' });
    expect(status).toBe(409);
    expect((codeBody as { error: string }).error).toBe('oauth_flow_not_awaiting_code');
  });

  it('manual-code round-trip → 200 + submitManualCode fed the pasted code', async () => {
    const { body } = await postStart({ provider: 'openai-codex' });
    const flowId = (body as { flow_id: string }).flow_id;
    // Drive the flow into the awaiting-code state.
    lastFlowOpts!.onAwaitingCode();

    const { status, body: codeBody } = await postCode({
      flow_id: flowId,
      code: 'PASTED-CODE',
    });
    expect(status).toBe(200);
    const parsed = OAuthManualCodeResponseSchema.parse(codeBody);
    expect(parsed.ok).toBe(true);
    expect(parsed.flow_id).toBe(flowId);
    // The pasted code reached the driver handle's submitManualCode.
    expect(submitManualCodeFn).toHaveBeenCalledWith('PASTED-CODE');
  });
});

describe('secret-leak guard — OAuth route', () => {
  it('no fake-blob access/refresh sentinel token appears in any published bus event', async () => {
    // Exercise every event-publishing path in one test.
    const blob = { refresh: 'REFRESH-SENTINEL-9f3a', access: 'ACCESS-SENTINEL-9f3a', expires: 1 };

    // Flow A — auth_url + progress + complete (config + state.changed).
    await postStart({ provider: 'anthropic' });
    lastFlowOpts!.onAuthUrl('https://provider/auth', 'open this');
    lastFlowOpts!.onProgress('exchanging code');
    lastFlowOpts!.onAwaitingCode('paste your code');
    await lastFlowOpts!.onComplete(blob);
    await flush();

    // Flow B — error path.
    await postStart({ provider: 'github-copilot' });
    lastFlowOpts!.onError('oauth_login_failed', 'some failure');

    // Flow C — keychain-unavailable error path.
    storeShouldReject = true;
    await postStart({ provider: 'openai-codex' });
    await lastFlowOpts!.onComplete(blob);
    await flush();

    // Across ALL published events, neither sentinel token appears.
    const serialized = JSON.stringify(publishedEvents);
    expect(serialized).not.toContain('ACCESS-SENTINEL-9f3a');
    expect(serialized).not.toContain('REFRESH-SENTINEL-9f3a');
    // Sanity — the test actually drove events through (guard is meaningful).
    expect(publishedEvents.length).toBeGreaterThan(0);
  });
});
