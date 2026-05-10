import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigSnapshotSchema } from '@swt-labs/dashboard-core';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerConfigRoute } from '../src/server/routes/config.ts';

let cwd: string;
let app: Hono;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'swt-config-route-'));
  app = new Hono();
  registerConfigRoute(app, cwd);
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
