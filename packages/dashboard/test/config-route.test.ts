import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConfigSnapshotSchema,
  ConfigUpdateResponseSchema,
  type SnapshotEvent,
} from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.ts';
import { registerConfigRoute } from '../src/server/routes/config.ts';

let cwd: string;
let app: Hono;
let bus: EventBus;
let busListener: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'swt-config-route-'));
  app = new Hono();
  bus = createEventBus();
  busListener = vi.fn();
  bus.subscribe(busListener);
  registerConfigRoute(app, cwd, bus);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  app = new Hono();
});

function writeConfig(content: string): void {
  mkdirSync(join(cwd, '.swt-planning'), { recursive: true });
  writeFileSync(join(cwd, '.swt-planning', 'config.json'), content, 'utf8');
}

async function getConfig(): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/api/config', { method: 'GET' });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/config', () => {
  it('returns greenfield envelope with DEFAULT_CONFIG when .swt-planning/ is missing', async () => {
    const { status, body } = await getConfig();
    expect(status).toBe(200);
    const parsed = ConfigSnapshotSchema.parse(body);
    expect(parsed.is_initialized).toBe(false);
    expect(parsed.source).toBe('default');
    // DEFAULT_CONFIG has well-known fields we can sanity-check on the
    // unknown payload to confirm the fallback actually fired.
    const cfg = parsed.config as Record<string, unknown>;
    expect(typeof cfg['effort']).toBe('string');
    expect(typeof cfg['autonomy']).toBe('string');
  });

  it('returns is_initialized:true with parsed config when config.json is valid', async () => {
    writeConfig(JSON.stringify({ effort: 'fast', autonomy: 'pure-vibe' }));
    const { status, body } = await getConfig();
    expect(status).toBe(200);
    const parsed = ConfigSnapshotSchema.parse(body);
    expect(parsed.is_initialized).toBe(true);
    expect(parsed.source).toBe('file');
    const cfg = parsed.config as Record<string, unknown>;
    expect(cfg['effort']).toBe('fast');
    expect(cfg['autonomy']).toBe('pure-vibe');
  });

  it('fills missing keys from DEFAULT_CONFIG when config.json is partial', async () => {
    // Only specify effort; autonomy etc. should still be present after parseConfig.
    writeConfig(JSON.stringify({ effort: 'turbo' }));
    const { status, body } = await getConfig();
    expect(status).toBe(200);
    const parsed = ConfigSnapshotSchema.parse(body);
    expect(parsed.is_initialized).toBe(true);
    const cfg = parsed.config as Record<string, unknown>;
    expect(cfg['effort']).toBe('turbo');
    expect(typeof cfg['autonomy']).toBe('string');
  });

  it('returns 500 with invalid_config_json error when config.json is unparseable', async () => {
    writeConfig('{ this is not valid json');
    const { status, body } = await getConfig();
    expect(status).toBe(500);
    const err = body as { error: string; detail: string };
    expect(err.error).toBe('invalid_config_json');
    expect(err.detail).toBeTypeOf('string');
  });

  it('returns 500 with invalid_config_schema error when config.json fails Zod validation', async () => {
    // effort must be one of the enum values; "nonsense" should fail parseConfig.
    writeConfig(JSON.stringify({ effort: 'nonsense-not-a-real-effort' }));
    const { status, body } = await getConfig();
    expect(status).toBe(500);
    const err = body as { error: string; detail: string };
    expect(err.error).toBe('invalid_config_schema');
    expect(err.detail).toBeTypeOf('string');
  });

  it('emits a generated_at ISO-8601 timestamp on every response', async () => {
    const { body } = await getConfig();
    const parsed = ConfigSnapshotSchema.parse(body);
    // Should round-trip through Date without throwing — proves it's a real
    // datetime, not just any string the schema's regex happened to accept.
    const t = new Date(parsed.generated_at).getTime();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });
});

describe('POST /api/config', () => {
  async function postConfig(body: unknown): Promise<{ status: number; body: unknown }> {
    const res = await app.request('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it('writes the config to .swt-planning/config.json and returns the validated shape', async () => {
    const { status, body } = await postConfig({
      config: { effort: 'fast', autonomy: 'pure-vibe' },
    });
    expect(status).toBe(200);
    const parsed = ConfigUpdateResponseSchema.parse(body);
    expect(parsed.ok).toBe(true);
    const cfg = parsed.config as Record<string, unknown>;
    expect(cfg['effort']).toBe('fast');
    expect(cfg['autonomy']).toBe('pure-vibe');
    // Verify the file actually landed on disk.
    const cfgPath = join(cwd, '.swt-planning', 'config.json');
    expect(existsSync(cfgPath)).toBe(true);
    const written = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
    expect(written['effort']).toBe('fast');
  });

  it("publishes a state.changed event with changed:['config'] exactly once on success", async () => {
    await postConfig({ config: { effort: 'fast' } });
    expect(busListener).toHaveBeenCalledTimes(1);
    const evt = busListener.mock.calls[0]?.[0] as SnapshotEvent;
    expect(evt.type).toBe('state.changed');
    if (evt.type === 'state.changed') {
      expect(evt.changed).toEqual(['config']);
    }
  });

  it('returns 400 invalid_config_body when the body is structurally wrong', async () => {
    const { status, body } = await postConfig({ wrong: 'shape' });
    expect(status).toBe(400);
    const err = body as { error: string };
    expect(err.error).toBe('invalid_config_body');
  });

  it('returns 400 invalid_config_schema when the inner config fails parseConfig', async () => {
    const { status, body } = await postConfig({
      config: { effort: 'nonsense-not-a-real-effort' },
    });
    expect(status).toBe(400);
    const err = body as { error: string; detail: string };
    expect(err.error).toBe('invalid_config_schema');
    expect(err.detail).toBeTypeOf('string');
  });

  it('creates .swt-planning/ on demand for greenfield daemons', async () => {
    // Confirm .swt-planning/ does not exist beforehand.
    expect(existsSync(join(cwd, '.swt-planning'))).toBe(false);
    const { status } = await postConfig({ config: { effort: 'turbo' } });
    expect(status).toBe(200);
    expect(existsSync(join(cwd, '.swt-planning', 'config.json'))).toBe(true);
  });

  it('does not publish a state.changed event when validation fails', async () => {
    await postConfig({ wrong: 'shape' });
    expect(busListener).not.toHaveBeenCalled();
  });

  // alpha.38 regression — credential wiring persistence.
  // Pre-fix bug: POST /api/config ran `parseConfig` which (via Zod's default
  // strip-unknown behavior) silently dropped the `auth` + `providers` keys
  // owned by `provider-auth.ts` / `provider-auth-oauth.ts`. Every Theme /
  // Model / Settings save then wrote the stripped result back, wiping the
  // user's keychain wiring from .swt-planning/config.json. The credentials
  // stayed in the OS keychain but the config block naming them was gone,
  // so on the next daemon restart `buildSnapshot.selected_provider` and
  // `resolveActiveProvider` could not consistently route to the pinned
  // provider — user-visible as "SWT forgot my OAuth / API key".
  describe('credential wiring preservation', () => {
    it('preserves auth + providers blocks across a POST /api/config write', async () => {
      // Seed the file with the exact shape provider-auth-oauth.ts writes
      // after a successful OAuth flow.
      writeConfig(
        JSON.stringify({
          effort: 'balanced',
          autonomy: 'standard',
          auth: {
            anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' },
            openrouter: { mode: 'api_key', credentialRef: 'swt:openrouter:api_key' },
          },
          providers: { strategy: { kind: 'pinned', provider: 'anthropic' } },
        }),
      );

      // Simulate a Theme dropdown click — client sends only the SwtConfig
      // surface it has from GET /api/config (which already strips
      // auth/providers via parseConfig), so auth + providers are NOT in
      // the request body.
      const { status } = await postConfig({
        config: { effort: 'fast', theme: 'dracula' },
      });
      expect(status).toBe(200);

      // Read back from disk — auth + providers must still be there,
      // and the new theme value must have landed.
      const cfgPath = join(cwd, '.swt-planning', 'config.json');
      const onDisk = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
      expect(onDisk['theme']).toBe('dracula');
      expect(onDisk['effort']).toBe('fast');
      expect(onDisk['auth']).toEqual({
        anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' },
        openrouter: { mode: 'api_key', credentialRef: 'swt:openrouter:api_key' },
      });
      expect(onDisk['providers']).toEqual({
        strategy: { kind: 'pinned', provider: 'anthropic' },
      });
    });

    it('writes cleanly on greenfield (no auth/providers to preserve)', async () => {
      // Confirm the preservation logic does not introduce empty keys
      // when there is nothing on disk to preserve.
      const { status } = await postConfig({ config: { effort: 'turbo' } });
      expect(status).toBe(200);
      const cfgPath = join(cwd, '.swt-planning', 'config.json');
      const onDisk = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
      expect(onDisk['effort']).toBe('turbo');
      // Greenfield: no auth/providers should be invented.
      expect('auth' in onDisk).toBe(false);
      expect('providers' in onDisk).toBe(false);
    });
  });
});
