/**
 * Milestone 21 Phase 01 — dashboard route smoke for the OpenAI OAuth branch.
 *
 * Sibling `provider-auth-oauth-route.test.ts` covers the full route surface
 * generically (auth_url + progress + complete + error + keychain-unavailable +
 * manual-code paste). This file is the narrow milestone-21 invariant:
 *
 *  1. POST `/api/provider-auth/oauth/start {provider: 'openai'}` with the
 *     credential-write header → 200; the SWT user-facing `'openai'` id reaches
 *     the response body, the `oauth.auth_url` event payload, the keychain
 *     write namespace, and the persisted `auth.openai` config block — NOT the
 *     mapped pi-ai id `'openai-codex'`. Only the up-front
 *     `getOAuthProvider(mapped)` undefined-check and the `runOAuthLoginFlow`
 *     `provider` field consume the mapped id.
 *  2. POST with a truly-unsupported provider still 400s
 *     `oauth_provider_unsupported` — identity-fallback in
 *     `mapToOAuthProviderId` does NOT break the rejection path.
 *
 * The mock surface: `@swt-labs/runtime`'s `runOAuthLoginFlow` is a
 * controllable fake (captures the route's opts), `storeOAuthCredentials`
 * resolves silently, `getOAuthProvider` returns a truthy stub for
 * `'openai-codex'` (the MAPPED id pi-ai's registry actually uses).
 * `mapToOAuthProviderId` is the REAL helper — the whole point of the smoke is
 * to prove the route correctly uses the live helper on the way in.
 *
 * No network calls. No browser. No real keychain. No live OAuth round-trip.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type * as SwtRuntime from '@swt-labs/runtime';
import { OAuthStartResponseSchema, type SnapshotEvent } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.ts';

type CapturedOpts = {
  provider: string;
  flowId: string;
  onAuthUrl: (url: string, instructions?: string) => void;
  onProgress: (message: string) => void;
  onAwaitingCode: (message?: string) => void;
  onComplete: (credentials: Record<string, unknown>) => Promise<void> | void;
  onError: (code: string, message: string) => void;
};

let lastFlowOpts: CapturedOpts | undefined;
const submitManualCodeFn = vi.fn();

const runOAuthLoginFlowMock = vi.fn((opts: CapturedOpts) => {
  lastFlowOpts = opts;
  return { submitManualCode: submitManualCodeFn };
});
const storeOAuthCredentialsMock = vi.fn(async () => {
  /* keychain write succeeds silently */
});
// Pi-ai's registry returns a truthy provider ONLY for the MAPPED id.
// `getOAuthProvider('openai')` is undefined upstream — the route is required
// to map first.
const getOAuthProviderMock = vi.fn((id: string) =>
  id === 'openai-codex' ? { id, name: 'OpenAI Codex' } : undefined,
);

// Preserve every OTHER `@swt-labs/runtime` export — in particular the real
// `mapToOAuthProviderId` so this test actually exercises the helper at the
// route's call site (rather than re-stubbing it).
vi.mock('@swt-labs/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof SwtRuntime>();
  return {
    ...actual,
    runOAuthLoginFlow: runOAuthLoginFlowMock,
    storeOAuthCredentials: storeOAuthCredentialsMock,
    getOAuthProvider: getOAuthProviderMock,
  };
});

// Imported AFTER `vi.mock` is registered (vitest hoists `vi.mock`).
const { registerProviderAuthOAuthRoute } =
  await import('../src/server/routes/provider-auth-oauth.ts');

let cwd: string;
let app: Hono;
let bus: EventBus;
let publishedEvents: SnapshotEvent[];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'swt-provider-auth-oauth-openai-'));
  app = new Hono();
  bus = createEventBus();
  publishedEvents = [];
  bus.subscribe((e: SnapshotEvent) => {
    publishedEvents.push(e);
  });
  lastFlowOpts = undefined;
  runOAuthLoginFlowMock.mockClear();
  storeOAuthCredentialsMock.mockClear();
  getOAuthProviderMock.mockClear();
  submitManualCodeFn.mockClear();
  registerProviderAuthOAuthRoute(app, cwd, bus);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const configPath = (): string => join(cwd, '.swt-planning', 'config.json');

async function postStart(body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/api/provider-auth/oauth/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-SWT-Credential-Write': 'confirm',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as unknown };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('POST /api/provider-auth/oauth/start — OpenAI Codex OAuth (milestone 21 Phase 01)', () => {
  it("accepts {provider: 'openai'}: 200, response/event/keychain/config carry user-facing 'openai'; pi-ai dispatch uses mapped 'openai-codex'", async () => {
    const { status, body } = await postStart({ provider: 'openai' });

    // (1) Response body — user-facing 'openai', NOT 'openai-codex'.
    expect(status).toBe(200);
    const parsed = OAuthStartResponseSchema.parse(body);
    expect(parsed.ok).toBe(true);
    expect(parsed.provider).toBe('openai');

    // (2) pi-ai's getOAuthProvider was called with the MAPPED id (the whole
    //     point of the milestone-21 fix). The mock above returns undefined
    //     for 'openai' but truthy for 'openai-codex' — if the route forgot to
    //     map, the supported-provider check at step 3 would 400.
    expect(getOAuthProviderMock).toHaveBeenCalledWith('openai-codex');

    // (3) runOAuthLoginFlow was kicked off — its `provider` field is the
    //     MAPPED id (so pi-ai's dispatch resolves), but the flowId is the
    //     response's flow_id (the route-generated correlator).
    expect(runOAuthLoginFlowMock).toHaveBeenCalledTimes(1);
    expect(lastFlowOpts?.provider).toBe('openai-codex');
    expect(lastFlowOpts?.flowId).toBe(parsed.flow_id);

    // (4) Drive the captured driver opts to publish an oauth.auth_url. The
    //     event payload's `provider` is the USER-FACING 'openai', NOT
    //     'openai-codex'.
    lastFlowOpts!.onAuthUrl('https://auth.openai.com/oauth/authorize?stub=1');
    const authUrlEvent = publishedEvents.find((e) => e.type === 'oauth.auth_url');
    expect(authUrlEvent).toBeDefined();
    if (authUrlEvent && authUrlEvent.type === 'oauth.auth_url') {
      expect(authUrlEvent.provider).toBe('openai');
      expect(authUrlEvent.url).toBe('https://auth.openai.com/oauth/authorize?stub=1');
    }

    // (5) Drive onComplete — keychain write namespace is swt:openai:oauth
    //     (NOT swt:openai-codex:oauth), and the persisted config block is
    //     auth.openai (NOT auth.openai-codex).
    const blob = {
      refresh: 'REFRESH-SENTINEL-7c1d',
      access: 'ACCESS-SENTINEL-7c1d',
      expires: 999,
    };
    await lastFlowOpts!.onComplete(blob);
    await flush();
    expect(storeOAuthCredentialsMock).toHaveBeenCalledWith('openai', blob);
    expect(existsSync(configPath())).toBe(true);
    const written = JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
    expect(written['auth']).toEqual({
      openai: { mode: 'oauth', credentialRef: 'swt:openai:oauth' },
    });

    // (6) The NO-LEAK invariant: 'openai-codex' MUST NOT appear anywhere in
    //     the response/event/config surface. Only pi-ai's dispatch (the mock
    //     above) sees the mapped id.
    const responseSerialized = JSON.stringify(parsed);
    const eventsSerialized = JSON.stringify(publishedEvents);
    const configSerialized = JSON.stringify(written);
    expect(responseSerialized).not.toContain('openai-codex');
    expect(eventsSerialized).not.toContain('openai-codex');
    expect(configSerialized).not.toContain('openai-codex');
  });

  it('truly-unsupported provider still 400s oauth_provider_unsupported with the user-facing id in the detail field', async () => {
    const { status, body } = await postStart({ provider: 'definitely-not-a-real-provider' });
    expect(status).toBe(400);
    const errorBody = body as { error: string; detail: string };
    expect(errorBody.error).toBe('oauth_provider_unsupported');
    // Identity-fallback in mapToOAuthProviderId returns the input verbatim
    // for any provider that does not need mapping — the
    // `getOAuthProvider(mapped)` undefined-check remains the SOLE rejection
    // path for truly-unsupported providers.
    expect(errorBody.detail).toBe('definitely-not-a-real-provider');
    // The driver was NOT kicked off for an unsupported provider.
    expect(runOAuthLoginFlowMock).not.toHaveBeenCalled();
  });
});
