/**
 * Tests for `updateConfigFile` — the alpha.40 structural protection against
 * the bug class that motivated alpha.38.
 *
 * **The invariant we lock in here:**
 *
 *   For any mutation that only touches a subset of top-level keys, every
 *   other top-level key MUST survive the write byte-identical.
 *
 * This is the test that — had it existed when milestone-22 shipped the Themes
 * dropdown — would have caught the silent Zod strip of `auth` + `providers`
 * blocks the moment the new POST /api/config write path landed. Any new
 * config-writing route that uses `updateConfigFile` inherits the preservation
 * guarantee.
 *
 * See `keychain_improvements.md` §1.1 + §1.2 for the design rationale.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { updateConfigFile } from '../src/server/lib/update-config-file.js';

describe('updateConfigFile (structural invariant)', () => {
  let dir: string;
  let cfgPath: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `swt-config-merge-test-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(dir, '.swt-planning'), { recursive: true });
    cfgPath = join(dir, '.swt-planning', 'config.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ───────────────────────────────────────────────────────────────────────
  // CORE INVARIANT — would have caught the alpha.38 Zod-strip bug instantly.
  // ───────────────────────────────────────────────────────────────────────

  it('CORE INVARIANT: a mutator touching only one key preserves every other top-level key byte-identical', async () => {
    const seed = {
      effort: 'balanced',
      theme: 'default',
      auth: { anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' } },
      providers: { strategy: { kind: 'pinned', provider: 'anthropic' } },
      model: 'claude-opus-4-7',
      custom_top_level: { nested: { deep: 'value' } },
    };
    await writeFile(cfgPath, JSON.stringify(seed, null, 2), 'utf8');

    // Mutator touches ONLY `theme` — every other key must survive.
    await updateConfigFile(cfgPath, (current) => {
      current['theme'] = 'dracula';
    });

    const after = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    expect(after['theme']).toBe('dracula');
    expect(after['effort']).toBe('balanced');
    expect(after['auth']).toEqual(seed.auth);
    expect(after['providers']).toEqual(seed.providers);
    expect(after['model']).toBe(seed.model);
    expect(after['custom_top_level']).toEqual(seed.custom_top_level);
  });

  it('CORE INVARIANT: simulates the post-alpha.38 config.ts write — Object.assign(validated) preserves auth + providers', async () => {
    // This is the exact scenario that motivated keychain_improvements.md.
    // Pre-alpha.38, config.ts validated through Zod ConfigSchema (which has
    // no `auth` or `providers`) and wrote the validated result back —
    // silently dropping the credential wiring on every Theme/Model/Settings
    // save. With updateConfigFile, the mutator's Object.assign only adds/
    // overwrites the keys it knows about; sibling-owned blocks survive.
    const seed = {
      effort: 'balanced',
      theme: 'default',
      auth: { anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' } },
      providers: { strategy: { kind: 'pinned', provider: 'anthropic' } },
    };
    await writeFile(cfgPath, JSON.stringify(seed, null, 2), 'utf8');

    // The validated SwtConfig (what parseConfig returns) — no auth/providers.
    const validated = { effort: 'turbo', theme: 'dracula', model: 'claude-opus-4-7' };

    await updateConfigFile(cfgPath, (current) => {
      Object.assign(current, validated);
    });

    const after = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    expect(after['effort']).toBe('turbo');
    expect(after['theme']).toBe('dracula');
    expect(after['model']).toBe('claude-opus-4-7');
    expect(after['auth']).toEqual(seed.auth); // <- the alpha.38 invariant
    expect(after['providers']).toEqual(seed.providers); // <- the alpha.38 invariant
  });

  it('CORE INVARIANT: simulates the provider-auth.ts write — mutates auth + providers, preserves preferences', async () => {
    const seed = {
      effort: 'turbo',
      theme: 'dracula',
      auth: { anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' } },
      providers: { strategy: { kind: 'pinned', provider: 'anthropic' } },
    };
    await writeFile(cfgPath, JSON.stringify(seed, null, 2), 'utf8');

    await updateConfigFile(cfgPath, (current) => {
      const prevAuth = (current['auth'] as Record<string, unknown>) ?? {};
      const prevProviders = (current['providers'] as Record<string, unknown>) ?? {};
      current['auth'] = {
        ...prevAuth,
        openrouter: { mode: 'api_key', credentialRef: 'swt:openrouter:api_key' },
      };
      current['providers'] = {
        ...prevProviders,
        strategy: { kind: 'pinned', provider: 'openrouter' },
      };
    });

    const after = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    // Preferences unchanged.
    expect(after['effort']).toBe('turbo');
    expect(after['theme']).toBe('dracula');
    // Both providers in auth block.
    expect((after['auth'] as Record<string, unknown>)['anthropic']).toEqual(seed.auth.anthropic);
    expect((after['auth'] as Record<string, unknown>)['openrouter']).toEqual({
      mode: 'api_key',
      credentialRef: 'swt:openrouter:api_key',
    });
    // Strategy switched to openrouter.
    expect(after['providers']).toEqual({
      strategy: { kind: 'pinned', provider: 'openrouter' },
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GRACEFUL DEGRADE — ENOENT + malformed-JSON paths.
  // ───────────────────────────────────────────────────────────────────────

  it('ENOENT: greenfield daemon (no config.json) writes a fresh file without inventing keys the mutator did not set', async () => {
    // cfgPath does NOT exist yet.
    await updateConfigFile(cfgPath, (current) => {
      current['effort'] = 'fast';
    });
    const after = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    expect(after).toEqual({ effort: 'fast' });
    // Critically: no `auth` / `providers` keys were invented from thin air.
    // The greenfield path must NOT manufacture credential-wiring scaffolds.
    expect('auth' in after).toBe(false);
    expect('providers' in after).toBe(false);
  });

  it('ENOENT: also creates the .swt-planning/ directory if missing', async () => {
    // Remove the .swt-planning dir to verify mkdir -p works.
    await rm(join(dir, '.swt-planning'), { recursive: true, force: true });
    await updateConfigFile(cfgPath, (current) => {
      current['effort'] = 'fast';
    });
    const after = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    expect(after['effort']).toBe('fast');
  });

  it('malformed JSON: degrades to empty current, writes the mutator output (no preservation possible)', async () => {
    await writeFile(cfgPath, '{ this is not valid json', 'utf8');
    await updateConfigFile(cfgPath, (current) => {
      current['effort'] = 'recovered';
    });
    const after = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    expect(after).toEqual({ effort: 'recovered' });
  });

  it('top-level array on disk: degrades to empty current (matches pre-helper graceful behavior)', async () => {
    // A bizarre but possible file. The mutator gets an empty object —
    // we don't merge into the array.
    await writeFile(cfgPath, JSON.stringify(['not', 'an', 'object']), 'utf8');
    await updateConfigFile(cfgPath, (current) => {
      current['effort'] = 'recovered';
    });
    const after = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    expect(after).toEqual({ effort: 'recovered' });
  });

  // ───────────────────────────────────────────────────────────────────────
  // OUTPUT FORMAT — matches the established convention.
  // ───────────────────────────────────────────────────────────────────────

  it('output is pretty-printed with 2-space indent + trailing newline (matches pre-helper convention)', async () => {
    await updateConfigFile(cfgPath, (current) => {
      current['effort'] = 'balanced';
      current['nested'] = { key: 'value' };
    });
    const raw = await readFile(cfgPath, 'utf8');
    expect(raw).toBe('{\n  "effort": "balanced",\n  "nested": {\n    "key": "value"\n  }\n}\n');
  });

  it('does not mutate the file when the mutator throws (the throw propagates)', async () => {
    const seed = { effort: 'balanced', auth: { anthropic: { mode: 'oauth' } } };
    await writeFile(cfgPath, JSON.stringify(seed), 'utf8');
    await expect(
      updateConfigFile(cfgPath, () => {
        throw new Error('mutator failed');
      }),
    ).rejects.toThrow('mutator failed');
    // File should be unchanged.
    const after = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    expect(after).toEqual(seed);
  });
});
