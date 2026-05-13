const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);

export interface AssertSafeBindingOptions {
  readonly host: string;
  readonly unsafePublic: boolean;
  /**
   * Plan 06-03 T4 (Phase 4 R4 carry-forward) — set to `true` when the
   * dashboard's per-request token middleware (`requireToken` from
   * `lib/auth.ts`) is installed on the `/api/*` router. When this flag
   * is `true`, the binding guard allows non-loopback bind addresses
   * WITHOUT the `unsafePublic` escape hatch — the auth middleware is
   * the substitute defense.
   *
   * When `unsafePublic` is false AND `authMiddlewareInstalled` is false,
   * non-loopback bind is rejected (today's behavior). When BOTH are
   * false but the operator requests `0.0.0.0` anyway, the call fails
   * closed via `UnsafeBindingError`.
   */
  readonly authMiddlewareInstalled?: boolean;
}

export class UnsafeBindingError extends Error {
  constructor(host: string) {
    super(
      `Refusing to bind to non-loopback host "${host}". Set SWT_DASHBOARD_UNSAFE_PUBLIC=1 ` +
        `or pass allowPublic=true to override, OR install the dashboard auth ` +
        `middleware (set SWT_DASHBOARD_TOKEN env var). The dashboard daemon is ` +
        `intended for localhost-only use without auth.`,
    );
    this.name = 'UnsafeBindingError';
  }
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function assertSafeBinding(opts: AssertSafeBindingOptions): void {
  if (opts.unsafePublic) return;
  // Plan 06-03 T4 — relax the loopback-only restriction when the auth
  // middleware is installed. The per-request token gate substitutes for
  // the loopback-only network boundary as the primary defense.
  if (opts.authMiddlewareInstalled === true) return;
  if (!isLoopbackHost(opts.host)) {
    throw new UnsafeBindingError(opts.host);
  }
}
