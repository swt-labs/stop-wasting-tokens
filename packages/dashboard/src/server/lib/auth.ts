import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Context, MiddlewareHandler } from 'hono';

/**
 * Plan 06-03 T4 (Phase 4 R4 carry-forward) — dashboard token authentication.
 *
 * The dashboard ships a binding-guard that restricts the daemon to
 * loopback by default. For multi-user-laptop hardening (Phase 4 R4 deferred
 * from PARITY-REPORT.md:105), this module adds a per-boot random token
 * that every `/api/*` request must carry in `Authorization: Bearer <token>`.
 *
 * Scope: per-boot random token only. NOT OAuth, NOT JWT, NOT user
 * accounts (those are Phase G). The token file is generated fresh on
 * each `swt dashboard` boot at `.swt-planning/.dashboard/token` with
 * 0600 perms — no persistent secrets in the repo.
 *
 * Two trigger surfaces:
 *
 *   1. `SWT_DASHBOARD_TOKEN` env var set on boot — the daemon enforces
 *      the gate against that exact value. CLI tooling and the SPA read
 *      the env var to authenticate. This is the OPS-driven surface.
 *
 *   2. The token file at `.swt-planning/.dashboard/token` — auto-
 *      generated on first call to `initDashboardToken()`. Lets shell
 *      tooling read the value without re-exporting the env var.
 *
 * The middleware exempts `/api/health` (liveness probes — uptime
 * monitoring shouldn't need an auth header). Every other `/api/*`
 * request requires the header; missing or mismatched returns 401.
 */

const TOKEN_DIR_REL = join('.swt-planning', '.dashboard');
const TOKEN_FILE_REL = join(TOKEN_DIR_REL, 'token');
const EXEMPT_PATHS = new Set<string>(['/api/health']);
const TOKEN_BYTES = 32;

export interface DashboardTokenOptions {
  /**
   * Project root the token file is written under. Defaults to
   * `process.cwd()`. Tests inject a temp dir to avoid clobbering the
   * operator's real `.swt-planning/.dashboard/token`.
   */
  readonly projectRoot?: string;
  /**
   * Pre-set token to use instead of generating one. Mostly for tests +
   * for ops who set `SWT_DASHBOARD_TOKEN` themselves; production boots
   * usually let the function generate a fresh value.
   */
  readonly token?: string;
}

/**
 * Initialize the dashboard token on boot. Writes the token to
 * `.swt-planning/.dashboard/token` with 0600 perms and returns it. If
 * `opts.token` is supplied, that value is written verbatim; otherwise
 * a fresh 32-byte hex token is generated.
 *
 * Idempotent: safe to call multiple times — the file is overwritten on
 * each call (per-boot semantics; no persistent reuse across reboots).
 */
export function initDashboardToken(opts: DashboardTokenOptions = {}): string {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const token = opts.token ?? randomBytes(TOKEN_BYTES).toString('hex');
  const filePath = join(projectRoot, TOKEN_FILE_REL);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, token, { encoding: 'utf8' });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Windows + some FS layers don't honor chmod; the loopback bind
    // is the primary defense, the token file mode is a hardening
    // backstop.
  }
  return token;
}

/**
 * Read the dashboard token from disk. Throws if the file does not
 * exist (the daemon hasn't booted yet or the operator deleted it).
 * Returns the trimmed file contents.
 */
export function readDashboardToken(opts: DashboardTokenOptions = {}): string {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const filePath = join(projectRoot, TOKEN_FILE_REL);
  if (!existsSync(filePath)) {
    throw new Error(
      `Dashboard token file missing at ${filePath}. Boot the daemon ` +
        `via \`swt dashboard\` first.`,
    );
  }
  return readFileSync(filePath, 'utf8').trim();
}

export interface RequireTokenOptions {
  /**
   * The exact token string to compare incoming `Authorization: Bearer`
   * headers against. Production boots resolve this from
   * `SWT_DASHBOARD_TOKEN` env var if set, falling back to a freshly
   * generated value written to the token file via
   * `initDashboardToken()`.
   */
  readonly token: string;
  /**
   * Override the exempt-paths set. Defaults to `['/api/health']` —
   * uptime probes don't need to know the token.
   */
  readonly exemptPaths?: ReadonlySet<string>;
}

/**
 * Hono middleware that enforces `Authorization: Bearer <token>` on
 * every `/api/*` request except the exempt-paths set. Returns 401 for
 * missing or mismatched headers.
 *
 * Apply BEFORE route handlers but AFTER the security-headers middleware
 * so 401 responses still carry the CSP / nosniff headers.
 *
 * Constant-time comparison via `crypto.timingSafeEqual` is OVERKILL
 * for a per-boot random token (the token has 256 bits of entropy; a
 * timing attack would need to brute-force one bit per request, which
 * is infeasible regardless). Simple string equality is sufficient.
 */
export function requireToken(opts: RequireTokenOptions): MiddlewareHandler {
  const expected = opts.token;
  const exempt = opts.exemptPaths ?? EXEMPT_PATHS;
  return async (c: Context, next): Promise<Response | void> => {
    if (exempt.has(c.req.path)) {
      await next();
      return;
    }
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || match[1] !== expected) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}

/**
 * Plan 06-03 T4 — resolve the dashboard auth token on daemon boot.
 *
 *   1. If `SWT_DASHBOARD_TOKEN` env var is set + non-empty, use that
 *      verbatim. The daemon still writes the value to the token file
 *      so shell tooling can read it without re-exporting the env var.
 *
 *   2. Otherwise generate a fresh per-boot token via
 *      `initDashboardToken()` (32 random bytes, hex-encoded, 0600 perms).
 *
 * Returns the token string. Pass to `requireToken({ token })` to wire
 * the middleware.
 */
export function resolveDashboardToken(opts: DashboardTokenOptions = {}): string {
  const fromEnv = process.env['SWT_DASHBOARD_TOKEN'];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return initDashboardToken({ ...opts, token: fromEnv });
  }
  return initDashboardToken(opts);
}
