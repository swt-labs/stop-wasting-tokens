import { SwtError } from '@swt-labs/core';

import type { VibeRoute } from './route.js';

export type VibeErrorCode = 'mode_not_implemented' | 'routing_error';

export class NotImplementedError extends SwtError {
  public readonly code = 'backend_error' as const;
  public readonly mode: VibeRoute['kind'];
  public readonly roadmap_pointer: string;

  constructor(mode: VibeRoute['kind'], roadmap_pointer: string) {
    super(`Mode "${mode}" is not yet implemented`, {
      context: { mode, roadmap_pointer },
    });
    this.mode = mode;
    this.roadmap_pointer = roadmap_pointer;
  }
}

export class RoutingError extends SwtError {
  public readonly code = 'backend_error' as const;

  constructor(message: string, context: Readonly<Record<string, unknown>>) {
    super(message, { context });
  }
}
