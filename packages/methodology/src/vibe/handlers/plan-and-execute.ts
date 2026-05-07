import type { VibeRoute } from '../route.js';

import { executeHandler, type ExecuteHandlerOptions } from './execute.js';
import { planHandler, type PlanHandlerOptions } from './plan.js';
import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export interface PlanAndExecuteHandlerOptions {
  readonly plan?: PlanHandlerOptions;
  readonly execute?: ExecuteHandlerOptions;
}

export function planAndExecuteHandler(
  opts: PlanAndExecuteHandlerOptions = {},
): ModeHandler {
  const planMode = planHandler(opts.plan);
  const executeMode = executeHandler(opts.execute);
  return {
    kind: 'plan-and-execute',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const planRoute: VibeRoute = {
        kind: 'plan-and-execute',
        ...(route.phase !== undefined ? { phase: route.phase } : {}),
        ...(route.phase_slug !== undefined ? { phase_slug: route.phase_slug } : {}),
        requires_confirmation: route.requires_confirmation,
        ...(route.reason !== undefined ? { reason: route.reason } : {}),
      };
      const planResult = await planMode.run(planRoute, io);
      if (planResult.exit !== 0) return { ...planResult, route };

      const executeRoute: VibeRoute = {
        kind: 'execute',
        ...(route.phase !== undefined ? { phase: route.phase } : {}),
        ...(route.phase_slug !== undefined ? { phase_slug: route.phase_slug } : {}),
        requires_confirmation: route.requires_confirmation,
        ...(route.reason !== undefined ? { reason: route.reason } : {}),
      };
      const executeResult = await executeMode.run(executeRoute, io);
      return { ...executeResult, route };
    },
  };
}
