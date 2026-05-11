import type { Context, MiddlewareHandler } from 'hono';

/**
 * Content-Security-Policy directives for the dashboard. Tightened so that
 * Manifest V3 content scripts (the MAIN-world injections used by Web3
 * wallets like MetaMask, Yoroi, Phantom, Rabby) are blocked at the browser
 * level. Without this, those extensions inject `inpage.js` + SES lockdown
 * into every `http://` page including localhost, which can break standard
 * JS primordials and trip subtle bugs in Solid reactivity / Set-membership
 * checks the dashboard's command-bar classifier relies on.
 *
 * The dashboard is a self-contained Solid SPA — every asset it needs is
 * served from its own origin. We never load third-party scripts, never
 * eval, never frame remote content. So `default-src 'self'` is correct
 * and won't break anything legitimate.
 *
 * The single exception: `'wasm-unsafe-eval'` under `script-src` because
 * some V8 bundling targets emit `WebAssembly.instantiate()` calls that
 * trip the default ban; including the directive future-proofs against
 * any tooling that adds a small wasm payload (we ship none today).
 *
 * NOTE: extension behavior varies by browser + version. Chromium-based
 * browsers (Chrome, Edge, Brave, Arc, Opera) respect MAIN_WORLD CSP
 * since 2023. Firefox content scripts have always respected CSP. Safari
 * extensions are sandboxed differently and rarely cause this class of bug.
 * If a future extension class bypasses CSP, the client-side
 * `detectExtensionInterference()` safety net catches it and shows a
 * remediation banner.
 */
const DEFAULT_DIRECTIVES: ReadonlyArray<readonly [string, string]> = [
  ['default-src', "'self'"],
  ['script-src', "'self' 'wasm-unsafe-eval'"],
  // Vite emits inline `<style>` blocks during dev + ships hashed CSS in
  // prod. 'unsafe-inline' is required for the inline blocks; the prod
  // bundle could use nonces, but the surface is small (no user input
  // reaches CSS) and the trade-off favors zero CSS regressions.
  ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data:"],
  ['font-src', "'self' data:"],
  // SSE + fetch — all same-origin (no third-party telemetry).
  ['connect-src', "'self'"],
  // Block embedding the dashboard in iframes (clickjacking defense).
  ['frame-ancestors', "'none'"],
  // Block <base> tag override (URL-rewriting defense).
  ['base-uri', "'none'"],
  // Block form submissions to other origins.
  ['form-action', "'self'"],
];

export const DEFAULT_CSP = DEFAULT_DIRECTIVES.map(([k, v]) => `${k} ${v}`).join('; ');

export interface SecurityHeadersOptions {
  /** Override the full CSP string. Default: `DEFAULT_CSP`. */
  readonly csp?: string;
  /**
   * Disable the CSP header entirely. Useful for unit tests that don't
   * exercise security headers, or for users who explicitly opt out via
   * `SWT_DASHBOARD_NO_CSP=1`. Default: false.
   */
  readonly disableCsp?: boolean;
}

/**
 * Hono middleware that sets defense-in-depth security headers on every
 * response. Apply BEFORE route handlers so even cached / static responses
 * receive the header.
 *
 *   - `Content-Security-Policy`: see DEFAULT_CSP rationale above.
 *   - `X-Content-Type-Options: nosniff`: prevent MIME sniffing.
 *   - `X-Frame-Options: DENY`: belt-and-suspenders against framing
 *     (CSP `frame-ancestors` is the modern equivalent, this covers older
 *     browsers that ignore CSP frame directives).
 *   - `Referrer-Policy: no-referrer`: no external referrer leakage.
 */
export function securityHeadersMiddleware(opts: SecurityHeadersOptions = {}): MiddlewareHandler {
  const csp = opts.csp ?? DEFAULT_CSP;
  const disableCsp = opts.disableCsp ?? false;
  return async (c: Context, next): Promise<void> => {
    if (!disableCsp) {
      c.header('Content-Security-Policy', csp);
    }
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  };
}
