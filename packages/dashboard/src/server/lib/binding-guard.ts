const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);

export interface AssertSafeBindingOptions {
  readonly host: string;
  readonly unsafePublic: boolean;
}

export class UnsafeBindingError extends Error {
  constructor(host: string) {
    super(
      `Refusing to bind to non-loopback host "${host}". Set SWT_DASHBOARD_UNSAFE_PUBLIC=1 ` +
        `or pass allowPublic=true to override. The dashboard daemon is intended for ` +
        `localhost-only use.`,
    );
    this.name = 'UnsafeBindingError';
  }
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function assertSafeBinding(opts: AssertSafeBindingOptions): void {
  if (opts.unsafePublic) return;
  if (!isLoopbackHost(opts.host)) {
    throw new UnsafeBindingError(opts.host);
  }
}
