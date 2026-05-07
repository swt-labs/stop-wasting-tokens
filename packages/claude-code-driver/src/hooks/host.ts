import type {
  HookContext,
  HookEvent,
  HookHandler,
  HookHost,
  HookOutcome,
  HookSubscription,
} from '@swt-labs/core';

/**
 * Claude Code's 12 documented lifecycle events. The driver observes them via
 * `claude --print --include-hook-events` (Plan 03-01's spawnClaude opts in
 * when callers want hook visibility) and routes each event into SWT's 6
 * generic event types via `CC_TO_SWT_EVENT_MAP`. Events without a mapping
 * are observable on the underlying stream but do not fire SWT-side handlers.
 */
export type ClaudeCodeHookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PreCompactRequest'
  | 'NotificationVariant'
  | 'PluginEvent';

/**
 * Mapping from Claude Code's 12 lifecycle events to SWT's 6 generic events.
 * Direct mappings are 1:1; merged mappings (e.g. SessionEnd → stop) collapse
 * multiple CC events into one SWT event. Events absent from the map
 * (Notification, PreCompact*, PluginEvent) are observable but unmapped — no
 * SWT-side handler fires.
 *
 * `permission_request` has no direct CC source; it is synthesized when CC
 * emits a permission decision request envelope (handled outside this map by
 * the spawn-stream parser).
 */
export const CC_TO_SWT_EVENT_MAP: Readonly<Partial<Record<ClaudeCodeHookEvent, HookEvent>>> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt_submit',
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  Stop: 'stop',
  SessionEnd: 'stop',
  SubagentStop: 'stop',
};

export class ClaudeCodeHookHost implements HookHost {
  private readonly subscriptions: Map<HookEvent, Set<HookHandler>> = new Map();

  on(event: HookEvent, handler: HookHandler): HookSubscription {
    let handlers = this.subscriptions.get(event);
    if (handlers === undefined) {
      handlers = new Set();
      this.subscriptions.set(event, handlers);
    }
    handlers.add(handler);
    let detached = false;
    return {
      unsubscribe: () => {
        if (detached) return;
        detached = true;
        const set = this.subscriptions.get(event);
        if (set !== undefined) {
          set.delete(handler);
          if (set.size === 0) this.subscriptions.delete(event);
        }
      },
    };
  }

  async dispatch(context: HookContext): Promise<HookOutcome> {
    const handlers = this.subscriptions.get(context.event);
    if (handlers === undefined || handlers.size === 0) {
      return { decision: 'allow' };
    }

    let firstBlock: { decision: 'block'; reason: string } | undefined;
    let sawObserve = false;

    for (const handler of handlers) {
      const outcome = await handler(context);
      if (outcome.decision === 'block') {
        if (firstBlock === undefined) firstBlock = outcome;
      } else if (outcome.decision === 'observe') {
        sawObserve = true;
      }
    }

    if (firstBlock !== undefined) return firstBlock;
    if (sawObserve) return { decision: 'observe' };
    return { decision: 'allow' };
  }

  async flush(): Promise<void> {
    // Claude Code does not require persistent hook config: subscriptions live
    // in-process and apply only to spawns this host issues. Flush is a no-op.
  }

  /**
   * Translate a Claude Code event into an SWT HookContext and dispatch.
   * Returns the dispatched HookOutcome, or `undefined` when the CC event
   * has no SWT mapping (the underlying stream is still observable; no
   * handlers fire).
   */
  async routeFromClaudeCode(
    ccEvent: ClaudeCodeHookEvent,
    payload: Readonly<Record<string, unknown>>,
    sessionId: string,
    cwd: string,
  ): Promise<HookOutcome | undefined> {
    const swtEvent = CC_TO_SWT_EVENT_MAP[ccEvent];
    if (swtEvent === undefined) return undefined;
    const context: HookContext = {
      event: swtEvent,
      session_id: sessionId,
      cwd,
      payload,
    };
    return this.dispatch(context);
  }
}
