import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CSP, securityHeadersMiddleware } from '../src/server/lib/csp.js';

function makeApp(opts?: Parameters<typeof securityHeadersMiddleware>[0]): Hono {
  const app = new Hono();
  app.use('*', securityHeadersMiddleware(opts));
  app.get('/probe', (c) => c.json({ ok: true }));
  return app;
}

describe('securityHeadersMiddleware', () => {
  it('sets Content-Security-Policy with the default directives', async () => {
    const res = await makeApp().request('/probe');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(DEFAULT_CSP);
  });

  it("CSP includes default-src 'self' and blocks frame-ancestors", async () => {
    const res = await makeApp().request('/probe');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("CSP script-src allows 'self' and 'wasm-unsafe-eval' but nothing else", async () => {
    const res = await makeApp().request('/probe');
    const csp = res.headers.get('content-security-policy') ?? '';
    // The script-src directive should permit self + wasm but NOT allow
    // 'unsafe-eval' / 'unsafe-inline' / external origins. This is the
    // load-bearing piece for blocking wallet-extension MAIN_WORLD
    // injection.
    const match = /script-src ([^;]+)/.exec(csp);
    expect(match).not.toBeNull();
    const directive = match?.[1] ?? '';
    expect(directive).toContain("'self'");
    expect(directive).toContain("'wasm-unsafe-eval'");
    expect(directive).not.toContain("'unsafe-eval'");
    expect(directive).not.toContain('https:');
  });

  it('sets X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy no-referrer', async () => {
    const res = await makeApp().request('/probe');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('disableCsp:true omits the CSP header but keeps the other security headers', async () => {
    const res = await makeApp({ disableCsp: true }).request('/probe');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('honors a custom csp override string', async () => {
    const custom = "default-src 'none'; script-src 'self'";
    const res = await makeApp({ csp: custom }).request('/probe');
    expect(res.headers.get('content-security-policy')).toBe(custom);
  });
});
