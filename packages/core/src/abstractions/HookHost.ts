/**
 * Lifecycle events SWT recognises across all backends. Two tiers:
 *
 * - v1.0 generic events (6): session_start, user_prompt_submit, pre_tool_use,
 *   post_tool_use, permission_request, stop. Map directly onto the hook
 *   surface every modern coding-agent backend exposes.
 * - v1.5 SDLC lifecycle events (6): pre_archive, post_phase, pre_phase,
 *   post_uat_fail, pre_qa, post_qa. Fire at SDLC milestones in the
 *   methodology layer; not natively supported by any backend.
 *
 * Total: 12 events.
 */
export type HookEvent =
  // v1.0 generic events
  | 'session_start'
  | 'user_prompt_submit'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'permission_request'
  | 'stop'
  // v1.5 SDLC lifecycle events
  | 'pre_archive'
  | 'post_phase'
  | 'pre_phase'
  | 'post_uat_fail'
  | 'pre_qa'
  | 'post_qa';

/**
 * Runtime list of every hook event. Stays in sync with the HookEvent type
 * union by construction. Useful for runtime validation and iteration.
 */
export const ALL_HOOK_EVENTS: readonly HookEvent[] = [
  'session_start',
  'user_prompt_submit',
  'pre_tool_use',
  'post_tool_use',
  'permission_request',
  'stop',
  'pre_archive',
  'post_phase',
  'pre_phase',
  'post_uat_fail',
  'pre_qa',
  'post_qa',
] as const;

export interface HookContext {
  readonly event: HookEvent;
  readonly session_id: string;
  readonly cwd: string;
  /** Backend-specific event payload. Consumers may narrow this. */
  readonly payload: Readonly<Record<string, unknown>>;
}

export type HookOutcome =
  | { decision: 'allow' }
  | { decision: 'block'; reason: string }
  | { decision: 'observe' };

export type HookHandler = (
  context: HookContext,
) => HookOutcome | Promise<HookOutcome>;

export interface HookSubscription {
  /** Detach this subscription. Idempotent. */
  unsubscribe(): void;
}

/**
 * Registers, dispatches, and observes lifecycle hooks. Backends implement this
 * by writing the appropriate config (e.g. hooks.json) and invoking handlers
 * when events arrive.
 */
export interface HookHost {
  on(event: HookEvent, handler: HookHandler): HookSubscription;
  dispatch(context: HookContext): Promise<HookOutcome>;
  /** Persist current registrations to backend config. */
  flush(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrowing helpers — one per HookEvent.
//
// Each helper is a TypeScript type guard that narrows a HookContext to the
// subset where ctx.event is the given literal. Callers can write:
//   if (isPreToolUseEvent(ctx)) { ctx.event; // typed as 'pre_tool_use' }
// ─────────────────────────────────────────────────────────────────────────────

export function isSessionStartEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'session_start' } {
  return ctx.event === 'session_start';
}

export function isUserPromptSubmitEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'user_prompt_submit' } {
  return ctx.event === 'user_prompt_submit';
}

export function isPreToolUseEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'pre_tool_use' } {
  return ctx.event === 'pre_tool_use';
}

export function isPostToolUseEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'post_tool_use' } {
  return ctx.event === 'post_tool_use';
}

export function isPermissionRequestEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'permission_request' } {
  return ctx.event === 'permission_request';
}

export function isStopEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'stop' } {
  return ctx.event === 'stop';
}

export function isPreArchiveEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'pre_archive' } {
  return ctx.event === 'pre_archive';
}

export function isPostPhaseEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'post_phase' } {
  return ctx.event === 'post_phase';
}

export function isPrePhaseEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'pre_phase' } {
  return ctx.event === 'pre_phase';
}

export function isPostUatFailEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'post_uat_fail' } {
  return ctx.event === 'post_uat_fail';
}

export function isPreQaEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'pre_qa' } {
  return ctx.event === 'pre_qa';
}

export function isPostQaEvent(
  ctx: HookContext,
): ctx is HookContext & { event: 'post_qa' } {
  return ctx.event === 'post_qa';
}
