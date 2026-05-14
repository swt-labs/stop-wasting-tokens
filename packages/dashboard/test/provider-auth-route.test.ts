import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ProviderAuthSnapshotSchema,
  ProviderAuthUpdateResponseSchema,
  type SnapshotEvent,
} from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.ts';

/* ── @swt-labs/runtime mock — NO real OS keychain in CI ─────────────────────
 *
 * `provider-auth.ts` imports exactly one symbol from `@swt-labs/runtime`:
 * `resolveCredentialStore`. We mock it with a module-level switch so each test
 * can pick the keychain-available fake (in-memory Map-backed store, all four
 * methods are `vi.fn()` so calls are assertable) or the keychain-unavailable
 * fake (an env-fallback-shaped store whose `set` REJECTS, mirroring Phase 1's
 * read-only env-fallback backend).
 */

type FakeStore = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
};
type FakeResolved = {
  store: FakeStore;
  backend: 'keychain' | 'env-fallback';
  probe: { available: boolean; reason?: string };
};

/** Build a keychain-available fake: an in-memory Map-backed store. */
function makeAvailableFake(): FakeResolved {
  const mem = new Map<string, string>();
  const key = (provider: string, mode: string): string => `${provider}:${mode}`;
  const store: FakeStore = {
    get: vi.fn(async (provider: string, mode: string) => mem.get(key(provider, mode))),
    set: vi.fn(async (provider: string, mode: string, secret: string) => {
      mem.set(key(provider, mode), secret);
    }),
    delete: vi.fn(async (provider: string, mode: string) => mem.delete(key(provider, mode))),
    list: vi.fn(async () => []),
  };
  return { store, backend: 'keychain', probe: { available: true } };
}

/** Build a keychain-unavailable fake: an env-fallback-shaped store whose
 *  `set` rejects with Phase 1's clear "Keychain unavailable..." message. */
function makeUnavailableFake(): FakeResolved {
  const store: FakeStore = {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {
      throw new Error(
        'Keychain unavailable on this host — cannot persist a credential. ' +
          'Set OPENAI_API_KEY in your environment instead.',
      );
    }),
    delete: vi.fn(async () => {
      throw new Error('Keychain unavailable on this host.');
    }),
    list: vi.fn(async () => []),
  };
  return {
    store,
    backend: 'env-fallback',
    probe: { available: false, reason: 'no Secret Service daemon' },
  };
}

// The module-level switch the mock reads. Each test sets it in `beforeEach`
// or inline before issuing requests.
let currentResolved: FakeResolved = makeAvailableFake();

vi.mock('@swt-labs/runtime', () => ({
  resolveCredentialStore: vi.fn(async () => currentResolved),
}));

// Imported AFTER `vi.mock` is registered (vitest hoists `vi.mock`, but keep
// the import here for clarity — the route picks up the mocked module).
const { registerProviderAuthRoute } = await import('../src/server/routes/provider-auth.ts');

let cwd: string;
let app: Hono;
let bus: EventBus;
let busListener: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'swt-provider-auth-route-'));
  app = new Hono();
  bus = createEventBus();
  busListener = vi.fn();
  bus.subscribe(busListener);
  // Default each test to the keychain-available fake; the keychain-unavailable
  // case opts in explicitly.
  currentResolved = makeAvailableFake();
  registerProviderAuthRoute(app, cwd, bus);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  app = new Hono();
});

const configPath = (): string => join(cwd, '.swt-planning', 'config.json');

function writeConfig(content: string): void {
  mkdirSync(join(cwd, '.swt-planning'), { recursive: true });
  writeFileSync(configPath(), content, 'utf8');
}

async function getAuth(): Promise<{ status: number; body: unknown; text: string }> {
  const res = await app.request('/api/provider-auth', { method: 'GET' });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as unknown, text };
}

async function postAuth(
  body: unknown,
  opts: { confirm?: boolean } = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.confirm !== false) headers['X-SWT-Credential-Write'] = 'confirm';
  const res = await app.request('/api/provider-auth', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as unknown, text };
}

describe('GET /api/provider-auth', () => {
  it('returns a greenfield ProviderAuthSnapshot when .swt-planning/ is missing', async () => {
    const { status, body } = await getAuth();
    expect(status).toBe(200);
    const parsed = ProviderAuthSnapshotSchema.parse(body);
    expect(parsed.selected_provider).toBeNull();
    expect(parsed.strategy_kind).toBe('pinned');
    // The keychain probe still runs in greenfield mode.
    expect(parsed.keychain_available).toBe(true);
    // One status entry per provider in the vocabulary.
    expect(parsed.statuses.length).toBeGreaterThan(0);
  });

  it('reflects the pinned selection from providers.strategy', async () => {
    writeConfig(
      JSON.stringify({ providers: { strategy: { kind: 'pinned', provider: 'openai' } } }),
    );
    const { status, body } = await getAuth();
    expect(status).toBe(200);
    const parsed = ProviderAuthSnapshotSchema.parse(body);
    expect(parsed.selected_provider).toBe('openai');
    expect(parsed.strategy_kind).toBe('pinned');
  });

  it('reports a non-pinned strategy kind with selected_provider null', async () => {
    writeConfig(JSON.stringify({ providers: { strategy: { kind: 'round-robin' } } }));
    const { body } = await getAuth();
    const parsed = ProviderAuthSnapshotSchema.parse(body);
    expect(parsed.selected_provider).toBeNull();
    expect(parsed.strategy_kind).toBe('round-robin');
  });

  it('is secret-free even when the keychain holds a stored value', async () => {
    // Pre-load the keychain-available fake with a stored secret.
    await currentResolved.store.set('openai', 'api_key', 'sk-super-secret-value');
    writeConfig(
      JSON.stringify({
        providers: { strategy: { kind: 'pinned', provider: 'openai' } },
        auth: { openai: { mode: 'api_key', credentialRef: 'swt:openai:api_key' } },
      }),
    );
    const { body, text } = await getAuth();
    const parsed = ProviderAuthSnapshotSchema.parse(body);
    // The provider IS reported configured...
    const openai = parsed.statuses.find((s) => s.provider === 'openai');
    expect(openai?.configured).toBe(true);
    // ...but the response carries NO secret value and NO secret-shaped key.
    expect(text).not.toContain('sk-super-secret-value');
    expect(text).not.toMatch(/sk-/);
    expect(text).not.toMatch(/"secret"/i);
    expect(text).not.toMatch(/"apiKey"/i);
    expect(text).not.toMatch(/"token"/i);
  });

  it('returns 500 when config.json is malformed JSON', async () => {
    writeConfig('{ not valid json');
    const { status, body } = await getAuth();
    expect(status).toBe(500);
    expect((body as { error: string }).error).toBe('provider_auth_read_failed');
  });
});

describe('POST /api/provider-auth', () => {
  it('returns 403 credential_write_confirmation_required without the X-SWT-Credential-Write header', async () => {
    const { status, body } = await postAuth(
      { provider: 'openai', authMode: 'api_key', apiKey: 'sk-x' },
      { confirm: false },
    );
    expect(status).toBe(403);
    expect((body as { error: string }).error).toBe('credential_write_confirmation_required');
    // The keychain write did NOT happen and config.json was NOT created.
    expect(currentResolved.store.set).not.toHaveBeenCalled();
    expect(existsSync(configPath())).toBe(false);
  });

  it('writes the key to the keychain + the selection to config.json with the header (200)', async () => {
    const { status, body, text } = await postAuth({
      provider: 'openai',
      authMode: 'api_key',
      apiKey: 'sk-test-xyz',
    });
    expect(status).toBe(200);
    // The keychain `set` was called exactly once with (provider, 'api_key', secret).
    expect(currentResolved.store.set).toHaveBeenCalledTimes(1);
    expect(currentResolved.store.set).toHaveBeenCalledWith('openai', 'api_key', 'sk-test-xyz');
    // The config file landed with the pinned selection + the auth block.
    expect(existsSync(configPath())).toBe(true);
    const written = JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
    expect(written['providers']).toEqual({ strategy: { kind: 'pinned', provider: 'openai' } });
    expect(written['auth']).toEqual({
      openai: { mode: 'api_key', credentialRef: 'swt:openai:api_key' },
    });
    // The response is a valid ProviderAuthUpdateResponse...
    const parsed = ProviderAuthUpdateResponseSchema.parse(body);
    expect(parsed.ok).toBe(true);
    // ...and the response body string does NOT contain the secret.
    expect(text).not.toContain('sk-test-xyz');
  });

  it('preserves other config keys on write', async () => {
    writeConfig(
      JSON.stringify({ effort: 'fast', autonomy: 'pure-vibe', providers: { fallback: ['x'] } }),
    );
    const { status } = await postAuth({
      provider: 'openai',
      authMode: 'api_key',
      apiKey: 'sk-keep',
    });
    expect(status).toBe(200);
    const written = JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
    // Untouched top-level keys survive.
    expect(written['effort']).toBe('fast');
    expect(written['autonomy']).toBe('pure-vibe');
    // The existing `providers.fallback` key survives alongside the new strategy.
    expect(written['providers']).toEqual({
      fallback: ['x'],
      strategy: { kind: 'pinned', provider: 'openai' },
    });
  });

  it('returns 400 invalid_provider_auth_body when the body has an unexpected key (.strict violation)', async () => {
    const { status, body } = await postAuth({
      provider: 'openai',
      authMode: 'api_key',
      extra: 'x',
    });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('invalid_provider_auth_body');
  });

  it('returns 400 invalid_provider_auth_body when provider is empty', async () => {
    const { status, body } = await postAuth({ provider: '', authMode: 'api_key' });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('invalid_provider_auth_body');
  });

  it('returns 400 unknown_provider for a provider outside the vocabulary', async () => {
    const { status, body } = await postAuth({
      provider: 'not-a-real-provider',
      authMode: 'api_key',
      apiKey: 'sk-x',
    });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('unknown_provider');
    expect(currentResolved.store.set).not.toHaveBeenCalled();
    expect(existsSync(configPath())).toBe(false);
  });

  it('returns 501 oauth_not_yet_supported for authMode:oauth and writes nothing', async () => {
    const { status, body } = await postAuth({ provider: 'openai', authMode: 'oauth' });
    expect(status).toBe(501);
    expect((body as { error: string }).error).toBe('oauth_not_yet_supported');
    // Nothing was written — no keychain set, no config file.
    expect(currentResolved.store.set).not.toHaveBeenCalled();
    expect(existsSync(configPath())).toBe(false);
  });

  it('returns 409 keychain_unavailable when the keychain set rejects, leaving config.json unchanged', async () => {
    // Switch to the keychain-unavailable fake and re-register the route so it
    // resolves the unavailable store.
    currentResolved = makeUnavailableFake();
    app = new Hono();
    registerProviderAuthRoute(app, cwd, bus);
    const { status, body } = await postAuth({
      provider: 'openai',
      authMode: 'api_key',
      apiKey: 'sk-rejected',
    });
    expect(status).toBe(409);
    expect((body as { error: string }).error).toBe('keychain_unavailable');
    // The keychain write failed BEFORE the config write — config.json untouched.
    expect(existsSync(configPath())).toBe(false);
  });

  it("publishes a state.changed event with changed including 'config' on a successful POST", async () => {
    await postAuth({ provider: 'openai', authMode: 'api_key', apiKey: 'sk-test-xyz' });
    expect(busListener).toHaveBeenCalledTimes(1);
    const evt = busListener.mock.calls[0]?.[0] as SnapshotEvent;
    expect(evt.type).toBe('state.changed');
    if (evt.type === 'state.changed') {
      expect(evt.changed).toContain('config');
    }
  });

  it('re-selection without an apiKey returns 200, skips the keychain write, but updates config', async () => {
    const { status, body } = await postAuth({ provider: 'openai', authMode: 'api_key' });
    expect(status).toBe(200);
    ProviderAuthUpdateResponseSchema.parse(body);
    // No keychain write — the existing entry is kept.
    expect(currentResolved.store.set).not.toHaveBeenCalled();
    // But the config WAS updated — the selection is pinned to openai.
    expect(existsSync(configPath())).toBe(true);
    const written = JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
    expect(written['providers']).toEqual({ strategy: { kind: 'pinned', provider: 'openai' } });
  });
});
