import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import {
  assertSafeBinding,
  isLoopbackHost,
  UnsafeBindingError,
} from '../../src/lib/binding-guard.js';
import { pickPort } from '../../src/lib/pick-port.js';

describe('binding-guard', () => {
  it('accepts loopback hosts', () => {
    expect(() => assertSafeBinding({ host: '127.0.0.1', unsafePublic: false })).not.toThrow();
    expect(() => assertSafeBinding({ host: 'localhost', unsafePublic: false })).not.toThrow();
    expect(() => assertSafeBinding({ host: '::1', unsafePublic: false })).not.toThrow();
    expect(isLoopbackHost('Localhost')).toBe(true);
  });

  it('rejects 0.0.0.0 without unsafePublic', () => {
    expect(() => assertSafeBinding({ host: '0.0.0.0', unsafePublic: false })).toThrow(
      UnsafeBindingError,
    );
  });

  it('rejects public IPs without unsafePublic', () => {
    expect(() => assertSafeBinding({ host: '192.168.1.42', unsafePublic: false })).toThrow(
      UnsafeBindingError,
    );
  });

  it('flips when unsafePublic=true', () => {
    expect(() => assertSafeBinding({ host: '0.0.0.0', unsafePublic: true })).not.toThrow();
  });
});

describe('pickPort', () => {
  it('returns a port within the requested range', async () => {
    const port = await pickPort({ start: 54320, end: 54330 });
    expect(port).toBeGreaterThanOrEqual(54320);
    expect(port).toBeLessThanOrEqual(54330);
  });

  it('falls back to OS-assigned when range is exhausted', async () => {
    // Hold port 54331 so the helper has to skip past at least one busy port.
    const blocker = createServer();
    await new Promise<void>((resolveBind, rejectBind) => {
      blocker.once('error', rejectBind);
      blocker.listen({ port: 54331, host: '127.0.0.1' }, () => resolveBind());
    });
    try {
      // Tiny window centered on the busy port; falls back to OS-assigned (>1024).
      const port = await pickPort({ start: 54331, end: 54331 });
      expect(port).toBeGreaterThan(1024);
      expect(port).not.toBe(54331);
    } finally {
      await new Promise<void>((resolveClose) => blocker.close(() => resolveClose()));
    }
  });
});
