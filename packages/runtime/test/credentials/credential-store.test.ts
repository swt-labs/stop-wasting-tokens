import { describe, expect, it } from 'vitest';

import { createCredentialStore } from '../../src/credentials/credential-store.js';
import { createInMemoryBackend } from '../../src/credentials/in-memory-backend.js';

describe('@swt-labs/runtime — createCredentialStore codec layer (Plan 01-01)', () => {
  it('set() then get() round-trips the secret value', async () => {
    const store = createCredentialStore({ backend: createInMemoryBackend() });
    await store.set('openai', 'api_key', 'sk-test-123');
    expect(await store.get('openai', 'api_key')).toBe('sk-test-123');
  });

  it('get() returns undefined for a never-set (provider, authMode)', async () => {
    const store = createCredentialStore({ backend: createInMemoryBackend() });
    expect(await store.get('never', 'api_key')).toBeUndefined();
  });

  it('delete() returns true when an entry existed, false on a second delete', async () => {
    const store = createCredentialStore({ backend: createInMemoryBackend() });
    await store.set('openai', 'api_key', 'sk-test-123');
    expect(await store.delete('openai', 'api_key')).toBe(true);
    expect(await store.delete('openai', 'api_key')).toBe(false);
  });

  it('list() returns secret-free CredentialRefs for every stored credential', async () => {
    const store = createCredentialStore({ backend: createInMemoryBackend() });
    await store.set('openai', 'api_key', 'sk-openai');
    await store.set('anthropic', 'oauth', 'sk-anthropic');

    const refs = await store.list();

    // Order-insensitive deep-equal.
    expect(refs).toHaveLength(2);
    expect(refs).toEqual(
      expect.arrayContaining([
        { provider: 'openai', authMode: 'api_key' },
        { provider: 'anthropic', authMode: 'oauth' },
      ]),
    );

    // Crucially — NO ref carries a secret value: each ref has EXACTLY the
    // keys `authMode` + `provider`, nothing resembling `secret`/`key`/`value`.
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(['authMode', 'provider']);
    }
  });

  it('writes through to the injected backend (set lands in backend.snapshot())', async () => {
    const backend = createInMemoryBackend();
    const store = createCredentialStore({ backend });
    await store.set('openai', 'api_key', 'sk-x');
    expect(backend.snapshot()['openai:api_key']).toBe('sk-x');
  });

  it('list() silently skips a backend account that fails to decode', async () => {
    const backend = createInMemoryBackend({
      'malformed-no-colon': 'junk',
      'openai:api_key': 'sk-y',
    });
    const store = createCredentialStore({ backend });

    const refs = await store.list();

    expect(refs).toEqual([{ provider: 'openai', authMode: 'api_key' }]);
    // And it did not throw — reaching this line proves it.
  });

  it('repeated get() is stable — returns the byte-identical value each call', async () => {
    const store = createCredentialStore({ backend: createInMemoryBackend() });
    await store.set('openai', 'api_key', 'sk-stable');
    const first = await store.get('openai', 'api_key');
    const second = await store.get('openai', 'api_key');
    const third = await store.get('openai', 'api_key');
    expect(first).toBe('sk-stable');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});
