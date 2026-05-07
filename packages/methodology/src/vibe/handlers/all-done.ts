import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export function allDoneHandler(): ModeHandler {
  return {
    kind: 'all-done',
    run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      io.stdout.write('◇ All work is in a steady state — nothing pending and nothing to archive yet.\n');
      return Promise.resolve({
        route,
        exit: 0,
        ranTo: 'completion',
        message: 'All phases complete; nothing to archive yet.',
      });
    },
  };
}
