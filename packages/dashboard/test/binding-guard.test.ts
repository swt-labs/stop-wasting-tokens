import { describe, expect, it } from 'vitest';

import {
  assertSafeBinding,
  isLoopbackHost,
  UnsafeBindingError,
} from '../src/server/lib/binding-guard.ts';

describe('server binding-guard', () => {
  it('accepts loopback hosts (IPv4, IPv6, localhost)', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0:0:0:0:0:0:0:1')).toBe(true);
    expect(() => assertSafeBinding({ host: '127.0.0.1', unsafePublic: false })).not.toThrow();
  });

  it('rejects 0.0.0.0 without unsafePublic', () => {
    expect(() => assertSafeBinding({ host: '0.0.0.0', unsafePublic: false })).toThrow(
      UnsafeBindingError,
    );
  });

  it('rejects public IPs without unsafePublic', () => {
    expect(() => assertSafeBinding({ host: '203.0.113.42', unsafePublic: false })).toThrow(
      UnsafeBindingError,
    );
  });

  it('unsafePublic flips the decision', () => {
    expect(() => assertSafeBinding({ host: '0.0.0.0', unsafePublic: true })).not.toThrow();
    expect(() => assertSafeBinding({ host: '203.0.113.42', unsafePublic: true })).not.toThrow();
  });

  // Plan 06-03 T4 (Phase 4 R4) — auth middleware substitutes for the
  // loopback-only restriction. Fail-closed semantics: relaxation only
  // applies when `authMiddlewareInstalled: true` is explicitly asserted
  // by the caller (createServer wires this from the resolved auth token).
  it('authMiddlewareInstalled relaxes the loopback restriction', () => {
    expect(() =>
      assertSafeBinding({
        host: '0.0.0.0',
        unsafePublic: false,
        authMiddlewareInstalled: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertSafeBinding({
        host: '203.0.113.42',
        unsafePublic: false,
        authMiddlewareInstalled: true,
      }),
    ).not.toThrow();
  });

  it('fails closed when authMiddlewareInstalled is false (default)', () => {
    expect(() =>
      assertSafeBinding({
        host: '0.0.0.0',
        unsafePublic: false,
        authMiddlewareInstalled: false,
      }),
    ).toThrow(UnsafeBindingError);
  });
});
