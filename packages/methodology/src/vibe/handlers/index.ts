import type { VibeRoute } from '../route.js';

export interface ModeIO {
  readonly cwd: string;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}

export interface HandlerResult {
  readonly route: VibeRoute;
  readonly exit: 0 | 1 | 2;
  readonly ranTo: 'completion' | 'stub';
  readonly message?: string;
}

export type ModeHandler = {
  readonly kind: VibeRoute['kind'];
  readonly run: (route: VibeRoute, io: ModeIO) => Promise<HandlerResult>;
};

export class ModeRegistry {
  private readonly handlers = new Map<VibeRoute['kind'], ModeHandler>();

  register(handler: ModeHandler): this {
    if (this.handlers.has(handler.kind)) {
      throw new Error(`Duplicate handler registration for kind=${handler.kind}`);
    }
    this.handlers.set(handler.kind, handler);
    return this;
  }

  has(kind: VibeRoute['kind']): boolean {
    return this.handlers.has(kind);
  }

  async dispatch(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
    const handler = this.handlers.get(route.kind);
    if (handler === undefined) {
      throw new Error(`No handler registered for kind=${route.kind}`);
    }
    return handler.run(route, io);
  }
}

export * from './stubs.js';
