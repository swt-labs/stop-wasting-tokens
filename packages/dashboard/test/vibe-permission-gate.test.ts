import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SnapshotEvent } from '@swt-labs/dashboard-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.js';
import { runMethodologyLoop } from '../src/server/vibe/loop.js';
import { ScriptedAgent } from '../src/server/vibe/methodology-agent.js';
import {
  DashboardPermissionGate,
  type ToolCall,
} from '../src/server/vibe/permission-gate.js';
import {
  createSessionRegistry,
  type SessionRegistry,
} from '../src/server/vibe/session.js';

const PROJECT_ROOT = '/tmp/test-proj';

let bus: EventBus;
let received: SnapshotEvent[];
let registry: SessionRegistry;
let planning_path: string;

beforeEach(() => {
  bus = createEventBus();
  received = [];
  bus.subscribe((evt) => received.push(evt));
  planning_path = mkdtempSync(join(tmpdir(), 'swt-permission-gate-'));
  registry = createSessionRegistry({ bus, planning_path });
});

afterEach(() => {
  registry.shutdown();
  rmSync(planning_path, { recursive: true, force: true });
});

function makeGate(session_id: string): DashboardPermissionGate {
  return new DashboardPermissionGate({
    registry,
    session_id,
    project_root: PROJECT_ROOT,
  });
}

describe('DashboardPermissionGate.classify (pure)', () => {
  let gate: DashboardPermissionGate;

  beforeEach(() => {
    registry.create({ project_root: PROJECT_ROOT, initial_prompt: 'p', id: 's1' });
    gate = makeGate('s1');
  });

  it('auto-allows file_read inside $HOME', () => {
    const result = gate.classify({ operation: 'read_file', target: join(homedir(), '.gitconfig') });
    expect(result.kind).toBe('auto-allow');
  });

  it('auto-allows file_read with relative path (resolves under cwd, treated in-project)', () => {
    const result = gate.classify({ operation: 'read_file', target: './README.md' });
    expect(result.kind).toBe('auto-allow');
  });

  it('requires-confirm for file_read outside $HOME', () => {
    const result = gate.classify({ operation: 'read_file', target: '/etc/hosts' });
    expect(result.kind).toBe('requires-confirm');
    if (result.kind === 'requires-confirm') {
      expect(result.risk_summary).toContain('outside your home directory');
    }
  });

  it('auto-allows file_write inside project root', () => {
    const result = gate.classify({
      operation: 'write_file',
      target: join(PROJECT_ROOT, 'src/foo.ts'),
    });
    expect(result.kind).toBe('auto-allow');
  });

  it('requires-confirm for file_write outside project root', () => {
    const result = gate.classify({
      operation: 'write_file',
      target: join(homedir(), '.gitconfig'),
    });
    expect(result.kind).toBe('requires-confirm');
  });

  it('always requires-confirm for shell', () => {
    expect(gate.classify({ operation: 'shell', target: 'echo hi' }).kind).toBe(
      'requires-confirm',
    );
    expect(gate.classify({ operation: 'shell', target: 'rm -rf /' }).kind).toBe(
      'requires-confirm',
    );
  });

  it('always requires-confirm for network', () => {
    expect(
      gate.classify({ operation: 'network', target: 'https://api.openai.com' }).kind,
    ).toBe('requires-confirm');
  });

  it('always requires-confirm for process_spawn', () => {
    expect(gate.classify({ operation: 'process_spawn', target: 'npm install' }).kind).toBe(
      'requires-confirm',
    );
  });

  it('auto-allows MCP action when server is trusted', () => {
    const result = gate.classify({
      operation: 'mcp_action',
      target: 'github/list-issues',
      mcp: { server_name: 'github', server_trusted: true },
    });
    expect(result.kind).toBe('auto-allow');
  });

  it('requires-confirm for MCP action when server is not trusted', () => {
    const result = gate.classify({
      operation: 'mcp_action',
      target: 'unknown/dangerous-tool',
      mcp: { server_name: 'unknown', server_trusted: false },
    });
    expect(result.kind).toBe('requires-confirm');
  });
});

describe('DashboardPermissionGate.requestApproval (integration)', () => {
  beforeEach(() => {
    registry.create({ project_root: PROJECT_ROOT, initial_prompt: 'p', id: 's1' });
  });

  it('returns {allowed: true, via: auto} for auto-allowed calls without emitting a prompt', async () => {
    const gate = makeGate('s1');
    const result = await gate.requestApproval({
      operation: 'write_file',
      target: join(PROJECT_ROOT, 'src/foo.ts'),
    });
    expect(result).toEqual({ allowed: true, via: 'auto' });
    expect(received.filter((e) => e.type === 'agent.prompt')).toHaveLength(0);
  });

  it('emits an agent.prompt with the right risk_summary for confirm-required calls', async () => {
    const gate = makeGate('s1');
    const promise = gate.requestApproval({
      operation: 'shell',
      target: 'npm install lodash',
    });
    // Let the prompt emit, then resolve.
    await Promise.resolve();
    const session = registry.get('s1')!;
    const pending = session.pending_prompt!;
    expect(pending.subtype).toBe('permission');
    expect(pending.context?.operation).toBe('shell');
    expect(pending.context?.target).toBe('npm install lodash');
    expect(pending.context?.risk_summary).toContain('Shell commands');

    // Resolve with approve-once.
    registry.reply('s1', pending.prompt_id, { kind: 'permission', decision: 'once' });
    const result = await promise;
    expect(result).toEqual({ allowed: true, via: 'user' });
  });

  it('"session" decision adds to allowlist; subsequent matching call auto-allows from allowlist', async () => {
    const gate = makeGate('s1');
    const call: ToolCall = { operation: 'shell', target: 'npm install lodash' };

    const first = gate.requestApproval(call);
    await Promise.resolve();
    const pending = registry.get('s1')!.pending_prompt!;
    registry.reply('s1', pending.prompt_id, { kind: 'permission', decision: 'session' });
    const firstResult = await first;
    expect(firstResult).toEqual({ allowed: true, via: 'user' });

    // Second call with the same operation+target should auto-allow.
    const second = await gate.requestApproval(call);
    expect(second).toEqual({ allowed: true, via: 'allowlist' });
    // No new prompt was emitted.
    const promptEvents = received.filter((e) => e.type === 'agent.prompt');
    expect(promptEvents).toHaveLength(1);
  });

  it('"deny" returns {allowed: false, reason: user_denied} with optional user_note', async () => {
    const gate = makeGate('s1');
    const promise = gate.requestApproval({ operation: 'shell', target: 'rm -rf /' });
    await Promise.resolve();
    const pending = registry.get('s1')!.pending_prompt!;
    registry.reply('s1', pending.prompt_id, {
      kind: 'permission',
      decision: 'deny',
      user_note: 'absolutely not',
    });
    const result = await promise;
    expect(result).toEqual({
      allowed: false,
      reason: 'user_denied',
      user_note: 'absolutely not',
    });
  });

  it('expiry returns {allowed: false, reason: user_no_reply}', async () => {
    // Create a session with a very short permission timeout.
    registry.create({
      project_root: PROJECT_ROOT,
      initial_prompt: 'p',
      id: 's-short',
      permission_timeout_ms: 30,
    });
    const gate = makeGate('s-short');
    const result = await gate.requestApproval({ operation: 'shell', target: 'echo hi' });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('user_no_reply');
    }
  });
});

describe('runMethodologyLoop with DashboardPermissionGate (e2e via ScriptedAgent)', () => {
  it('agent tool_call routes through the gate and proceeds when approved', async () => {
    const session = registry.create({
      project_root: PROJECT_ROOT,
      initial_prompt: 'p',
      id: 's1',
    });
    const gate = makeGate(session.id);
    const agent = new ScriptedAgent({
      script: [
        {
          type: 'tool_call',
          call: { operation: 'shell', target: 'pnpm install' },
          fail_on_deny: true,
        },
        { type: 'complete' },
      ],
    });

    const loopPromise = runMethodologyLoop({
      agent,
      registry,
      bus,
      gate,
      session_id: session.id,
      prompt: 'p',
    });

    // Wait for the prompt, then approve.
    await waitFor(() => registry.get(session.id)!.pending_prompt !== null, 200);
    const pending = registry.get(session.id)!.pending_prompt!;
    registry.reply(session.id, pending.prompt_id, { kind: 'permission', decision: 'once' });

    const result = await loopPromise;
    expect(result.success).toBe(true);
    expect(agent.received_decisions).toHaveLength(1);
    expect(agent.received_decisions[0]).toEqual({ allowed: true, via: 'user' });
  });

  it('agent tool_call with fail_on_deny + denied decision fails the run', async () => {
    const session = registry.create({
      project_root: PROJECT_ROOT,
      initial_prompt: 'p',
      id: 's1',
    });
    const gate = makeGate(session.id);
    const agent = new ScriptedAgent({
      script: [
        {
          type: 'tool_call',
          call: { operation: 'shell', target: 'rm -rf /' },
          fail_on_deny: true,
        },
        { type: 'complete' },
      ],
    });

    const loopPromise = runMethodologyLoop({
      agent,
      registry,
      bus,
      gate,
      session_id: session.id,
      prompt: 'p',
    });

    await waitFor(() => registry.get(session.id)!.pending_prompt !== null, 200);
    const pending = registry.get(session.id)!.pending_prompt!;
    registry.reply(session.id, pending.prompt_id, { kind: 'permission', decision: 'deny' });

    const result = await loopPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('tool_denied');
  });

  it('auto-allowed in-project tool_call does not emit a prompt', async () => {
    const session = registry.create({
      project_root: PROJECT_ROOT,
      initial_prompt: 'p',
      id: 's1',
    });
    const gate = makeGate(session.id);
    const agent = new ScriptedAgent({
      script: [
        {
          type: 'tool_call',
          call: { operation: 'write_file', target: join(PROJECT_ROOT, 'foo.ts') },
        },
        { type: 'complete' },
      ],
    });

    const result = await runMethodologyLoop({
      agent,
      registry,
      bus,
      gate,
      session_id: session.id,
      prompt: 'p',
    });

    expect(result.success).toBe(true);
    expect(agent.received_decisions[0]).toEqual({ allowed: true, via: 'auto' });
    expect(received.filter((e) => e.type === 'agent.prompt')).toHaveLength(0);
  });

  it('agent without a wired requestApproval fails on tool_call', async () => {
    const session = registry.create({
      project_root: PROJECT_ROOT,
      initial_prompt: 'p',
      id: 's1',
    });
    const agent = new ScriptedAgent({
      script: [
        {
          type: 'tool_call',
          call: { operation: 'write_file', target: join(PROJECT_ROOT, 'foo.ts') },
        },
        { type: 'complete' },
      ],
    });

    // No gate passed → loop omits requestApproval → ScriptedAgent fails.
    const result = await runMethodologyLoop({
      agent,
      registry,
      bus,
      session_id: session.id,
      prompt: 'p',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('requestApproval');
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
