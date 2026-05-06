/**
 * Lifecycle events SWT recognises across all backends. Backends may support
 * additional events natively, but the methodology layer only relies on these
 * six.
 */
export type HookEvent =
  | 'session_start'
  | 'user_prompt_submit'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'permission_request'
  | 'stop';

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
