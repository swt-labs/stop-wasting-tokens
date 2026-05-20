/**
 * Unit tests for `resolveActiveProvider` — the alpha.37 chat-route fix.
 *
 * The pre-fix chat route used `Object.keys(authConfig)[0]` as the active
 * provider, silently ignoring the TopBar Provider dropdown's pin
 * (`config.providers.strategy.provider`). These tests pin the resolution
 * order:
 *
 *   1. Pinned strategy that matches an auth entry → use the pin.
 *   2. Pinned strategy that does NOT match an auth entry → fall through
 *      (the pin is stale; the auth block is the source of truth for what
 *      credentials we actually have).
 *   3. Unpinned (or non-pinned strategy kind) → first auth-block entry.
 *   4. Empty auth → `provider: null, source: 'none'`.
 *
 * Plus graceful-degrade for missing/malformed config.json (mirrors
 * `readProjectAuthConfig`'s NEVER-throws contract).
 */

import { describe, expect, it } from 'vitest';

import { resolveActiveProvider } from '../../src/credentials/resolve-active-provider.js';

interface FakeFs {
  readFileSync: (path: string) => string;
  existsSync: (path: string) => boolean;
}

function fakeFs(contents: string | null): FakeFs {
  return {
    readFileSync: (): string => {
      if (contents === null) throw new Error('ENOENT');
      return contents;
    },
    existsSync: (): boolean => contents !== null,
  };
}

describe('resolveActiveProvider', () => {
  it('pinned strategy wins when the pinned provider has an auth entry', () => {
    const fs = fakeFs(
      JSON.stringify({
        providers: { strategy: { kind: 'pinned', provider: 'openrouter' } },
        auth: {
          anthropic: { mode: 'oauth' },
          openrouter: { mode: 'api_key' },
        },
        model: 'deepseek/deepseek-v4-flash',
      }),
    );
    const sel = resolveActiveProvider(
      '/proj',
      fs as unknown as Parameters<typeof resolveActiveProvider>[1],
    );
    expect(sel.provider).toBe('openrouter');
    expect(sel.source).toBe('pinned');
    expect(sel.model).toBe('deepseek/deepseek-v4-flash');
    expect(Object.keys(sel.authConfig).sort()).toEqual(['anthropic', 'openrouter']);
  });

  it('stale pin (provider not in auth block) falls through to first-authed', () => {
    // The dropdown's pinned strategy may reference a provider that hasn't been
    // saved to auth yet (e.g., user pinned openrouter but never entered a
    // key). The auth block is the source of truth for what credentials we
    // actually have — fall back rather than handing the chat session a
    // provider with no credential.
    const fs = fakeFs(
      JSON.stringify({
        providers: { strategy: { kind: 'pinned', provider: 'openrouter' } },
        auth: { anthropic: { mode: 'oauth' } },
      }),
    );
    const sel = resolveActiveProvider(
      '/proj',
      fs as unknown as Parameters<typeof resolveActiveProvider>[1],
    );
    expect(sel.provider).toBe('anthropic');
    expect(sel.source).toBe('first-authed');
  });

  it('unpinned strategy falls back to first auth-block entry (insertion order)', () => {
    const fs = fakeFs(
      JSON.stringify({
        providers: { strategy: { kind: 'round-robin' } },
        auth: {
          anthropic: { mode: 'oauth' },
          openrouter: { mode: 'api_key' },
        },
      }),
    );
    const sel = resolveActiveProvider(
      '/proj',
      fs as unknown as Parameters<typeof resolveActiveProvider>[1],
    );
    expect(sel.provider).toBe('anthropic');
    expect(sel.source).toBe('first-authed');
  });

  it('no providers block + non-empty auth → first-authed fallback', () => {
    const fs = fakeFs(
      JSON.stringify({
        auth: { openrouter: { mode: 'api_key' } },
      }),
    );
    const sel = resolveActiveProvider(
      '/proj',
      fs as unknown as Parameters<typeof resolveActiveProvider>[1],
    );
    expect(sel.provider).toBe('openrouter');
    expect(sel.source).toBe('first-authed');
    expect(sel.model).toBeNull();
  });

  it('empty auth → provider null, source none', () => {
    const fs = fakeFs(JSON.stringify({ auth: {} }));
    const sel = resolveActiveProvider(
      '/proj',
      fs as unknown as Parameters<typeof resolveActiveProvider>[1],
    );
    expect(sel.provider).toBeNull();
    expect(sel.source).toBe('none');
    expect(sel.authConfig).toEqual({});
  });

  it('missing config.json → empty selection (never throws)', () => {
    const fs = fakeFs(null);
    const sel = resolveActiveProvider(
      '/proj',
      fs as unknown as Parameters<typeof resolveActiveProvider>[1],
    );
    expect(sel.provider).toBeNull();
    expect(sel.source).toBe('none');
    expect(sel.model).toBeNull();
  });

  it('malformed JSON → empty selection (never throws)', () => {
    const fs = fakeFs('{ not valid json');
    const sel = resolveActiveProvider(
      '/proj',
      fs as unknown as Parameters<typeof resolveActiveProvider>[1],
    );
    expect(sel.provider).toBeNull();
    expect(sel.source).toBe('none');
  });

  it('model field is surfaced verbatim when set', () => {
    const fs = fakeFs(
      JSON.stringify({
        auth: { anthropic: { mode: 'oauth' } },
        model: 'claude-opus-4-7',
      }),
    );
    const sel = resolveActiveProvider(
      '/proj',
      fs as unknown as Parameters<typeof resolveActiveProvider>[1],
    );
    expect(sel.model).toBe('claude-opus-4-7');
  });

  it('empty-string model treated as null', () => {
    const fs = fakeFs(
      JSON.stringify({
        auth: { anthropic: { mode: 'oauth' } },
        model: '',
      }),
    );
    const sel = resolveActiveProvider(
      '/proj',
      fs as unknown as Parameters<typeof resolveActiveProvider>[1],
    );
    expect(sel.model).toBeNull();
  });
});
