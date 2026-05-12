import { describe, expect, it } from 'vitest';

import {
  MockAgentSpawner,
  MockHookHost,
  MockMemoryStore,
  MockPermissionGate,
} from './mock-driver.js';

describe('mock backend driver', () => {
  it('HookHost dispatches events to subscribers', async () => {
    const host = new MockHookHost();
    const seen: string[] = [];
    host.on('session_start', (ctx) => {
      seen.push(ctx.session_id);
      return { decision: 'allow' };
    });
    const outcome = await host.dispatch({
      event: 'session_start',
      session_id: 'sess-1',
      cwd: '/tmp',
      payload: {},
    });
    expect(outcome.decision).toBe('allow');
    expect(seen).toEqual(['sess-1']);
  });

  it('HookHost short-circuits on a blocking handler', async () => {
    const host = new MockHookHost();
    host.on('pre_tool_use', () => ({ decision: 'block', reason: 'denied' }));
    host.on('pre_tool_use', () => ({ decision: 'allow' }));
    const outcome = await host.dispatch({
      event: 'pre_tool_use',
      session_id: 's',
      cwd: '/tmp',
      payload: {},
    });
    expect(outcome.decision).toBe('block');
  });

  it('AgentSpawner installs and spawns agents', async () => {
    const spawner = new MockAgentSpawner();
    await spawner.installAgent({
      role: 'lead',
      model: 'gpt-x',
      thinking_level: 'high',
      developer_instructions: 'plan thoroughly',
      allowed_mcp_servers: [],
    });
    expect(spawner.installed.has('lead')).toBe(true);
    const result = await spawner.spawn({
      spec: spawner.installed.get('lead')!,
      prompt: 'plan this',
      cwd: '/tmp',
      session_id: 's',
    });
    expect(result.success).toBe(true);
    expect(result.role).toBe('lead');
  });

  it('PermissionGate enforces read-only profiles', async () => {
    const gate = new MockPermissionGate();
    await gate.registerProfile({
      name: 'ro',
      sandbox_mode: 'read-only',
      approval_policy: 'never',
      writable_roots: [],
    });
    const allow = await gate.evaluate({
      profile: 'ro',
      tool: 'Read',
      args: {},
      cwd: '/tmp',
    });
    const deny = await gate.evaluate({
      profile: 'ro',
      tool: 'Write',
      args: {},
      cwd: '/tmp',
    });
    expect(allow.allow).toBe(true);
    expect(deny.allow).toBe(false);
  });

  it('MemoryStore round-trips entries by topic and tag', async () => {
    const store = new MockMemoryStore();
    await store.put({
      id: 'm1',
      topic: 'auth',
      content: 'sessions use cookies',
      tags: ['login', 'security'],
    });
    await store.put({
      id: 'm2',
      topic: 'queue',
      content: 'redis streams',
      tags: ['infra'],
    });
    expect(await store.get('m1')).toMatchObject({ topic: 'auth' });
    expect(await store.query({ topic: 'auth' })).toHaveLength(1);
    expect(await store.query({ tag: 'infra' })).toHaveLength(1);
    expect(await store.query({ limit: 1 })).toHaveLength(1);
  });
});
