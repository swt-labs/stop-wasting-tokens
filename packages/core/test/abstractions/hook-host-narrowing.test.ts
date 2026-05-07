import { describe, expect, it } from 'vitest';

import {
  ALL_HOOK_EVENTS,
  isPostPhaseEvent,
  isPostQaEvent,
  isPostToolUseEvent,
  isPostUatFailEvent,
  isPreArchiveEvent,
  isPrePhaseEvent,
  isPreQaEvent,
  isPreToolUseEvent,
  isPermissionRequestEvent,
  isSessionStartEvent,
  isStopEvent,
  isUserPromptSubmitEvent,
  type HookContext,
  type HookEvent,
} from '../../src/abstractions/HookHost.js';

function makeCtx(event: HookEvent): HookContext {
  return {
    event,
    session_id: 'sess-1',
    cwd: '/tmp',
    payload: {},
  };
}

describe('HookHost narrowing helpers', () => {
  it('isPreToolUseEvent returns true for pre_tool_use, false for any other event', () => {
    expect(isPreToolUseEvent(makeCtx('pre_tool_use'))).toBe(true);
    for (const e of ALL_HOOK_EVENTS) {
      if (e === 'pre_tool_use') continue;
      expect(isPreToolUseEvent(makeCtx(e))).toBe(false);
    }
  });

  it('isPostToolUseEvent returns true for post_tool_use, false for any other event', () => {
    expect(isPostToolUseEvent(makeCtx('post_tool_use'))).toBe(true);
    for (const e of ALL_HOOK_EVENTS) {
      if (e === 'post_tool_use') continue;
      expect(isPostToolUseEvent(makeCtx(e))).toBe(false);
    }
  });

  it('isPreArchiveEvent returns true for pre_archive, false for any other event', () => {
    expect(isPreArchiveEvent(makeCtx('pre_archive'))).toBe(true);
    for (const e of ALL_HOOK_EVENTS) {
      if (e === 'pre_archive') continue;
      expect(isPreArchiveEvent(makeCtx(e))).toBe(false);
    }
  });

  it('isPostPhaseEvent returns true for post_phase, false for any other event', () => {
    expect(isPostPhaseEvent(makeCtx('post_phase'))).toBe(true);
    for (const e of ALL_HOOK_EVENTS) {
      if (e === 'post_phase') continue;
      expect(isPostPhaseEvent(makeCtx(e))).toBe(false);
    }
  });

  it('TypeScript narrowing: inside if (isPreToolUseEvent(ctx)), ctx.event is the literal "pre_tool_use"', () => {
    const ctx = makeCtx('pre_tool_use');
    if (isPreToolUseEvent(ctx)) {
      // Compile-time check via const-string assignment.
      const event: 'pre_tool_use' = ctx.event;
      expect(event).toBe('pre_tool_use');
    } else {
      throw new Error('expected narrowing to succeed for pre_tool_use ctx');
    }
  });

  it('ALL_HOOK_EVENTS has length 12 and every event passes its corresponding narrowing helper', () => {
    expect(ALL_HOOK_EVENTS).toHaveLength(12);

    const helpers: Record<HookEvent, (ctx: HookContext) => boolean> = {
      session_start: isSessionStartEvent,
      user_prompt_submit: isUserPromptSubmitEvent,
      pre_tool_use: isPreToolUseEvent,
      post_tool_use: isPostToolUseEvent,
      permission_request: isPermissionRequestEvent,
      stop: isStopEvent,
      pre_archive: isPreArchiveEvent,
      post_phase: isPostPhaseEvent,
      pre_phase: isPrePhaseEvent,
      post_uat_fail: isPostUatFailEvent,
      pre_qa: isPreQaEvent,
      post_qa: isPostQaEvent,
    };

    for (const event of ALL_HOOK_EVENTS) {
      const helper = helpers[event];
      expect(helper(makeCtx(event))).toBe(true);
    }
  });
});
