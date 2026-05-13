import { SwtError } from '@swt-labs/core';

export type VibeErrorCode = 'routing_error';

export class RoutingError extends SwtError {
  public readonly code = 'backend_error' as const;

  constructor(message: string, context: Readonly<Record<string, unknown>>) {
    super(message, { context });
  }
}
