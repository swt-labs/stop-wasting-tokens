import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SnapshotEvent } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.js';
import {
  createSessionRegistry,
  listPersistedSessionIds,
  readSessionEventsLog,
  type SessionRegistry,
} from '../src/server/vibe/session.js';

let bus: EventBus;
let received: SnapshotEvent[];
let registry: SessionRegistry;
let planning_path: string;

beforeEach(() => {
  bus = createEventBus();
  received = [];
  bus.subscribe((evt) => received.push(evt));
  planning_path = mkdtempSync(join(tmpdir(), 'swt-vibe-session-'));
  registry = createSessionRegistry({ bus, planning_path });
});

afterEach(() => {
  registry.shutdown();
  rmSync(planning_path, { recursive: true, force: true });
});

describe('createSessionRegistry', () => {
  it('creates a session with idle state and writes a session.created log entry', () => {
    const session = registry.create({
      project_root: '/tmp/proj',
      initial_prompt: 'build me a snake game',
      id: 'sess-1',
    });
    expect(session.id).toBe('sess-1');
    expect(session.state).toBe('idle');
    expect(session.pending_prompt).toBeNull();

    const log = readSessionEventsLog(planning_path, 'sess-1');
    expect(log).toHaveLength(1);
    expect((log[0] as { type: string }).type).toBe('session.created');
  });

  it('rejects duplicate session ids', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-dup' });
    expect(() =>
      registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-dup' }),
    ).toThrow();
  });
});

describe('emitPrompt', () => {
  it('publishes an agent.prompt event and transitions to awaiting-reply', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'What color?',
    });
    expect(prompt).not.toBeNull();
    const session = registry.get('sess-1')!;
    expect(session.state).toBe('awaiting-reply');
    expect(session.pending_prompt?.prompt_id).toBe(prompt!.prompt_id);
    const promptEvents = received.filter((e) => e.type === 'agent.prompt');
    expect(promptEvents).toHaveLength(1);
    expect(promptEvents[0]).toMatchObject({
      session_id: 'sess-1',
      subtype: 'clarification',
      question: 'What color?',
    });
  });

  it('returns null when a prompt is already pending (FIFO single-outstanding rule)', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const first = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'First?',
    });
    expect(first).not.toBeNull();
    const second = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'Second?',
    });
    expect(second).toBeNull();
  });

  it('returns null for unknown session', () => {
    const result = registry.emitPrompt('does-not-exist', {
      subtype: 'clarification',
      question: 'huh?',
    });
    expect(result).toBeNull();
  });

  it('uses permission timeout (5min default) for permission prompts', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const before = Date.now();
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'permission',
      question: 'shell ok?',
      context: { operation: 'shell', target: 'npm install' },
    })!;
    const after = Date.now();
    const expiresMs = new Date(prompt.expires_at).getTime();
    const expectedMin = before + 5 * 60 * 1000 - 50;
    const expectedMax = after + 5 * 60 * 1000 + 50;
    expect(expiresMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresMs).toBeLessThanOrEqual(expectedMax);
  });
});

describe('reply', () => {
  it('accepts a matching free-form reply and transitions to running', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'What goal?',
    })!;
    const result = registry.reply('sess-1', prompt.prompt_id, {
      kind: 'free_form',
      text: 'a snake game',
    });
    expect(result.ok).toBe(true);
    const session = registry.get('sess-1')!;
    expect(session.state).toBe('running');
    expect(session.pending_prompt).toBeNull();
  });

  it('accepts a matching choice reply', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'Color?',
      options: [
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
      ],
    })!;
    const result = registry.reply('sess-1', prompt.prompt_id, {
      kind: 'choice',
      value: 'red',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects choice reply with unknown value (invalid_answer_kind)', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'Color?',
      options: [{ value: 'red', label: 'Red' }],
    })!;
    const result = registry.reply('sess-1', prompt.prompt_id, {
      kind: 'choice',
      value: 'purple',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_answer_kind');
  });

  it('rejects free-form reply for a permission prompt (subtype mismatch)', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'permission',
      question: 'shell ok?',
      context: { operation: 'shell', target: 'rm -rf /' },
    })!;
    const result = registry.reply('sess-1', prompt.prompt_id, {
      kind: 'free_form',
      text: 'sure',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_answer_kind');
  });

  it('rejects mismatched prompt_id with the expected id', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'q?',
    })!;
    const result = registry.reply('sess-1', 'wrong-id', { kind: 'free_form', text: 'a' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('prompt_id_mismatch');
    expect(result.expected_prompt_id).toBe(prompt.prompt_id);
  });

  it('rejects reply for a session not awaiting reply (session_not_blocking)', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const result = registry.reply('sess-1', 'any', { kind: 'free_form', text: 'a' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('session_not_blocking');
  });

  it('rejects reply for unknown session (session_not_found)', () => {
    const result = registry.reply('nope', 'any', { kind: 'free_form', text: 'a' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('session_not_found');
  });

  it('persists the reply to the events log', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'q?',
    })!;
    registry.reply('sess-1', prompt.prompt_id, { kind: 'free_form', text: 'answer' });
    const log = readSessionEventsLog(planning_path, 'sess-1');
    const replies = log.filter((e) => (e as { type: string }).type === 'session.reply');
    expect(replies).toHaveLength(1);
  });

  it('adds to permission allowlist when "session" decision is given', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'permission',
      question: 'shell ok?',
      context: { operation: 'shell', target: 'npm install' },
    })!;
    registry.reply('sess-1', prompt.prompt_id, {
      kind: 'permission',
      decision: 'session',
    });
    const session = registry.get('sess-1')!;
    expect(session.permission_allowlist.has('shell::npm install')).toBe(true);
  });
});

describe('awaitReply', () => {
  it('resolves with the reply when the user replies', async () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'q?',
    })!;
    const replyPromise = registry.awaitReply('sess-1');
    registry.reply('sess-1', prompt.prompt_id, { kind: 'free_form', text: 'hi' });
    const reply = await replyPromise;
    expect(reply).toEqual({ kind: 'free_form', text: 'hi' });
  });

  it('rejects awaitReply when no prompt is pending', async () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    await expect(registry.awaitReply('sess-1')).rejects.toThrow();
  });
});

describe('expiry', () => {
  it('emits agent.prompt.timeout and resolves awaiter with kind=expired after timeout', async () => {
    registry.create({
      project_root: '/tmp/proj',
      initial_prompt: 'p',
      id: 'sess-1',
      clarification_timeout_ms: 30,
    });
    registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'q?',
    });
    const replyPromise = registry.awaitReply('sess-1');
    const reply = await replyPromise;
    expect(reply).toEqual({ kind: 'expired' });
    const timeoutEvents = received.filter((e) => e.type === 'agent.prompt.timeout');
    expect(timeoutEvents).toHaveLength(1);
    const session = registry.get('sess-1')!;
    expect(session.state).toBe('running');
    expect(session.pending_prompt).toBeNull();
  });
});

describe('disk persistence', () => {
  it('readSessionEventsLog returns the JSONL events for a session', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'sess-1' });
    const prompt = registry.emitPrompt('sess-1', {
      subtype: 'clarification',
      question: 'q?',
    })!;
    registry.reply('sess-1', prompt.prompt_id, { kind: 'free_form', text: 'a' });
    const log = readSessionEventsLog(planning_path, 'sess-1');
    expect(log.length).toBeGreaterThanOrEqual(3); // created + prompt + reply
    const types = log.map((e) => (e as { type: string }).type);
    expect(types).toContain('session.created');
    expect(types).toContain('agent.prompt');
    expect(types).toContain('session.reply');
  });

  it('listPersistedSessionIds returns all session dirs', () => {
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'a' });
    registry.create({ project_root: '/tmp/proj', initial_prompt: 'p', id: 'b' });
    const ids = listPersistedSessionIds(planning_path);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('listPersistedSessionIds returns [] when no sessions dir exists', () => {
    const empty = mkdtempSync(join(tmpdir(), 'swt-vibe-empty-'));
    try {
      expect(listPersistedSessionIds(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
