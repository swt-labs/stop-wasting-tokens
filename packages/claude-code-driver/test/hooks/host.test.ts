import type { HookContext } from '@swt-labs/core';
import { describe, expect, it, vi } from 'vitest';


import { ClaudeCodeHookHost } from '../../src/hooks/host.js';

const baseContext = (event: HookContext['event']): HookContext => ({
  event,
  session_id: 'sess',
  cwd: '/tmp',
  payload: {},
});

describe('ClaudeCodeHookHost', () => {
  it('on → dispatch invokes the registered handler with the context', async () => {
    const host = new ClaudeCodeHookHost();
    const handler = vi.fn().mockResolvedValue({ decision: 'allow' });
    host.on('pre_tool_use', handler);

    const outcome = await host.dispatch(baseContext('pre_tool_use'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ event: 'pre_tool_use' }));
    expect(outcome).toEqual({ decision: 'allow' });
  });

  it('unsubscribe removes the handler and is idempotent on re-call', async () => {
    const host = new ClaudeCodeHookHost();
    const handler = vi.fn().mockResolvedValue({ decision: 'allow' });
    const sub = host.on('stop', handler);

    sub.unsubscribe();
    sub.unsubscribe();

    await host.dispatch(baseContext('stop'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('block-precedes-allow: any blocking handler wins with the first reason', async () => {
    const host = new ClaudeCodeHookHost();
    host.on('pre_tool_use', () => ({ decision: 'allow' }));
    host.on('pre_tool_use', () => ({ decision: 'block', reason: 'unsafe path' }));
    host.on('pre_tool_use', () => ({ decision: 'allow' }));

    const outcome = await host.dispatch(baseContext('pre_tool_use'));

    expect(outcome).toEqual({ decision: 'block', reason: 'unsafe path' });
  });

  it('observe-fallthrough: observe wins over allow when no block fired', async () => {
    const host = new ClaudeCodeHookHost();
    host.on('post_tool_use', () => ({ decision: 'allow' }));
    host.on('post_tool_use', () => ({ decision: 'observe' }));

    const outcome = await host.dispatch(baseContext('post_tool_use'));

    expect(outcome).toEqual({ decision: 'observe' });
  });

  it('routeFromClaudeCode for direct mapping (PreToolUse → pre_tool_use) dispatches', async () => {
    const host = new ClaudeCodeHookHost();
    const handler = vi.fn().mockResolvedValue({ decision: 'allow' });
    host.on('pre_tool_use', handler);

    const outcome = await host.routeFromClaudeCode('PreToolUse', { tool: 'Bash' }, 'sess', '/tmp');

    expect(outcome).toEqual({ decision: 'allow' });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pre_tool_use', payload: { tool: 'Bash' } }),
    );
  });

  it('routeFromClaudeCode for unmapped event (Notification) returns undefined and fires no handler', async () => {
    const host = new ClaudeCodeHookHost();
    const handler = vi.fn().mockResolvedValue({ decision: 'allow' });
    host.on('pre_tool_use', handler);
    host.on('post_tool_use', handler);

    const outcome = await host.routeFromClaudeCode('Notification', {}, 'sess', '/tmp');

    expect(outcome).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('routeFromClaudeCode for merged mapping (SessionEnd → stop) reaches stop handlers', async () => {
    const host = new ClaudeCodeHookHost();
    const handler = vi.fn().mockResolvedValue({ decision: 'allow' });
    host.on('stop', handler);

    const outcome = await host.routeFromClaudeCode('SessionEnd', {}, 'sess', '/tmp');

    expect(outcome).toEqual({ decision: 'allow' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
