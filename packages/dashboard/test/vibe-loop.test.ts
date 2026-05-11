import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SnapshotEvent } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.js';
import { runMethodologyLoop } from '../src/server/vibe/loop.js';
import { ScriptedAgent } from '../src/server/vibe/methodology-agent.js';
import { createSessionRegistry, type SessionRegistry } from '../src/server/vibe/session.js';

let bus: EventBus;
let received: SnapshotEvent[];
let registry: SessionRegistry;
let planning_path: string;

beforeEach(() => {
  bus = createEventBus();
  received = [];
  bus.subscribe((evt) => received.push(evt));
  planning_path = mkdtempSync(join(tmpdir(), 'swt-vibe-loop-'));
  registry = createSessionRegistry({ bus, planning_path });
});

afterEach(() => {
  registry.shutdown();
  rmSync(planning_path, { recursive: true, force: true });
});

describe('runMethodologyLoop', () => {
  it('drives a stdout-only ScriptedAgent to completion', async () => {
    const session = registry.create({
      project_root: '/tmp/proj',
      initial_prompt: 'p',
      id: 's1',
    });
    const agent = new ScriptedAgent({
      script: [
        { type: 'stdout', line: 'starting...' },
        { type: 'stdout', line: 'done' },
        { type: 'complete', text: 'all good' },
      ],
    });
    const result = await runMethodologyLoop({
      agent,
      registry,
      bus,
      session_id: session.id,
      prompt: 'p',
    });
    expect(result.success).toBe(true);
    expect(result.text).toBe('all good');
    expect(registry.get(session.id)!.state).toBe('completed');
    const logLines = received.filter((e) => e.type === 'log.append');
    expect(logLines).toHaveLength(2);
  });

  it('handles ScriptedAgent that asks one question and gets a free-form reply', async () => {
    const session = registry.create({
      project_root: '/tmp/proj',
      initial_prompt: 'p',
      id: 's1',
    });
    const agent = new ScriptedAgent({
      script: [
        {
          type: 'ask',
          request: { subtype: 'clarification', question: 'What goal?' },
        },
        { type: 'complete' },
      ],
    });

    const loopPromise = runMethodologyLoop({
      agent,
      registry,
      bus,
      session_id: session.id,
      prompt: 'p',
    });

    // Wait until the prompt has been emitted, then reply.
    await waitFor(() => registry.get(session.id)!.pending_prompt !== null, 200);
    const pending = registry.get(session.id)!.pending_prompt!;
    const replyResult = registry.reply(session.id, pending.prompt_id, {
      kind: 'free_form',
      text: 'a snake game',
    });
    expect(replyResult.ok).toBe(true);

    const result = await loopPromise;
    expect(result.success).toBe(true);
    expect(registry.get(session.id)!.state).toBe('completed');
    expect(agent.received_replies).toEqual([{ kind: 'free_form', text: 'a snake game' }]);
  });

  it('handles a permission ask and "session" decision', async () => {
    const session = registry.create({
      project_root: '/tmp/proj',
      initial_prompt: 'p',
      id: 's1',
    });
    const agent = new ScriptedAgent({
      script: [
        {
          type: 'ask',
          request: {
            subtype: 'permission',
            question: 'shell ok?',
            context: { operation: 'shell', target: 'npm install' },
          },
        },
        { type: 'complete' },
      ],
    });

    const loopPromise = runMethodologyLoop({
      agent,
      registry,
      bus,
      session_id: session.id,
      prompt: 'p',
    });

    await waitFor(() => registry.get(session.id)!.pending_prompt !== null, 200);
    const pending = registry.get(session.id)!.pending_prompt!;
    registry.reply(session.id, pending.prompt_id, {
      kind: 'permission',
      decision: 'session',
    });

    await loopPromise;
    expect(registry.get(session.id)!.permission_allowlist.has('shell::npm install')).toBe(true);
  });

  it('routes a fail action through error event and sets state=failed', async () => {
    const session = registry.create({
      project_root: '/tmp/proj',
      initial_prompt: 'p',
      id: 's1',
    });
    const agent = new ScriptedAgent({
      script: [{ type: 'fail', error: 'boom' }],
    });
    const result = await runMethodologyLoop({
      agent,
      registry,
      bus,
      session_id: session.id,
      prompt: 'p',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
    expect(registry.get(session.id)!.state).toBe('failed');
    const errorEvents = received.filter(
      (e) => e.type === 'error' && (e as { code: string }).code === 'agent_failed',
    );
    expect(errorEvents).toHaveLength(1);
  });

  it('captures expired reply when prompt times out before user answers', async () => {
    const session = registry.create({
      project_root: '/tmp/proj',
      initial_prompt: 'p',
      id: 's1',
      clarification_timeout_ms: 30,
    });
    const agent = new ScriptedAgent({
      script: [
        {
          type: 'ask',
          request: { subtype: 'clarification', question: 'q?' },
        },
        { type: 'complete' },
      ],
    });
    await runMethodologyLoop({
      agent,
      registry,
      bus,
      session_id: session.id,
      prompt: 'p',
    });
    expect(agent.received_replies).toEqual([{ kind: 'expired' }]);
    const timeouts = received.filter((e) => e.type === 'agent.prompt.timeout');
    expect(timeouts).toHaveLength(1);
  });

  it('treats agent throw as session failure with loop_failed error code', async () => {
    const session = registry.create({
      project_root: '/tmp/proj',
      initial_prompt: 'p',
      id: 's1',
    });
    const throwingAgent = {
      run: async () => {
        throw new Error('agent crashed');
      },
    };
    const result = await runMethodologyLoop({
      agent: throwingAgent,
      registry,
      bus,
      session_id: session.id,
      prompt: 'p',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('agent crashed');
    expect(registry.get(session.id)!.state).toBe('failed');
    const errors = received.filter(
      (e) => e.type === 'error' && (e as { code: string }).code === 'loop_failed',
    );
    expect(errors).toHaveLength(1);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
