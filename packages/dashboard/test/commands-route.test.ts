import { CommandRegistrySchema } from '@swt-labs/dashboard-core';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_NON_INTERACTIVE_VERBS,
  COMMAND_REGISTRY_ENTRIES,
  INTERACTIVE_VERBS,
} from '../src/server/lib/command-registry-mirror.ts';
import { registerCommandsRoute } from '../src/server/routes/commands.ts';

let app: Hono;

beforeEach(() => {
  app = new Hono();
  registerCommandsRoute(app);
});

async function getCommands(): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/api/commands', { method: 'GET' });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/commands', () => {
  it('returns the full mirror as a CommandRegistry envelope', async () => {
    const { status, body } = await getCommands();
    expect(status).toBe(200);
    const registry = CommandRegistrySchema.parse(body);
    expect(registry.verbs.length).toBe(COMMAND_REGISTRY_ENTRIES.length);
    expect(registry.verbs.length).toBeGreaterThanOrEqual(20);
  });

  it('emits a generated_at ISO-8601 timestamp on every response', async () => {
    const { body } = await getCommands();
    const registry = CommandRegistrySchema.parse(body);
    const t = new Date(registry.generated_at).getTime();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });

  it('every entry in ALLOWED_NON_INTERACTIVE_VERBS appears with dashboard_safe:true', async () => {
    const { body } = await getCommands();
    const registry = CommandRegistrySchema.parse(body);
    for (const verb of ALLOWED_NON_INTERACTIVE_VERBS) {
      const entry = registry.verbs.find((e) => e.name === verb);
      expect(entry, `missing verb ${verb} in registry mirror`).toBeDefined();
      expect(entry?.dashboard_safe, `verb ${verb} should be dashboard_safe`).toBe(true);
    }
  });

  it('every entry in INTERACTIVE_VERBS appears with dashboard_safe:false', async () => {
    const { body } = await getCommands();
    const registry = CommandRegistrySchema.parse(body);
    for (const verb of INTERACTIVE_VERBS) {
      const entry = registry.verbs.find((e) => e.name === verb);
      expect(entry, `missing verb ${verb} in registry mirror`).toBeDefined();
      expect(entry?.dashboard_safe, `verb ${verb} should NOT be dashboard_safe`).toBe(false);
    }
  });

  it('verbs are returned in alphabetical order (matches `swt help`)', async () => {
    const { body } = await getCommands();
    const registry = CommandRegistrySchema.parse(body);
    const names = registry.verbs.map((v) => v.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('every category value is one of core | stub | interactive', async () => {
    const { body } = await getCommands();
    const registry = CommandRegistrySchema.parse(body);
    const valid = new Set(['core', 'stub', 'interactive']);
    for (const v of registry.verbs) {
      expect(valid.has(v.category), `unexpected category ${v.category} for ${v.name}`).toBe(true);
    }
  });
});
