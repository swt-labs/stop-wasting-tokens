/**
 * Base error type for all SWT errors. Subclasses set a literal `code` so
 * callers can narrow with `instanceof` or by inspecting the discriminant.
 */
export type SwtErrorCode =
  | 'config_error'
  | 'handoff_error'
  | 'permission_denied'
  | 'memory_error'
  | 'backend_error';

export interface SwtErrorOptions {
  cause?: unknown;
  /** Optional structured context for logging / telemetry. */
  context?: Readonly<Record<string, unknown>>;
}

export abstract class SwtError extends Error {
  public abstract readonly code: SwtErrorCode;
  public readonly context: Readonly<Record<string, unknown>>;

  constructor(message: string, options: SwtErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
    this.context = Object.freeze({ ...(options.context ?? {}) });
  }

  /**
   * JSON-serialisable shape suitable for telemetry. Excludes `cause` because
   * it can contain non-serialisable values; consumers can call `formatCause`
   * separately when they need that detail.
   */
  toJSON(): {
    name: string;
    code: SwtErrorCode;
    message: string;
    context: Readonly<Record<string, unknown>>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

export class ConfigError extends SwtError {
  public readonly code = 'config_error' as const;
}

export class HandoffError extends SwtError {
  public readonly code = 'handoff_error' as const;
}

export class PermissionDeniedError extends SwtError {
  public readonly code = 'permission_denied' as const;
}

export class MemoryError extends SwtError {
  public readonly code = 'memory_error' as const;
}

export class BackendError extends SwtError {
  public readonly code = 'backend_error' as const;
}

export function isSwtError(value: unknown): value is SwtError {
  return value instanceof SwtError;
}

export function formatCause(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
