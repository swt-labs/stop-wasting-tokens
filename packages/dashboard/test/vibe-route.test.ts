import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.js';
import { registerVibeRoutes } from '../src/server/routes/vibe.js';
import {
  createSessionRegistry,
  type SessionRegistry,
} from '../src/server/vibe/session.js';

let app: Hono;
let registry: SessionRegistry;
let bus: EventBus;
let planning_path: string;

beforeEach(() => {
  app = new Hono();
  bus = createEventBus();
  planning_path = mkdtempSync(join(tmpdir(), 'swt-vibe-route-'));
  registry = createSessionRegistry({ bus, planning_path });
  registerVibeRoutes(app, { registry, project_root: '/tmp/proj' });
});

afterEach(() => {
  registry.shutdown();
  rmSync(planning_path, { recursive: true, force: true });
});

async function postJSON(
  path: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /api/vibe', () => {
  it('creates a session and returns session_id + idle state', async () => {
    const { status, body } = await postJSON('/api/vibe', {
      prompt: 'build me a snake game',
    });
    expect(status).toBe(200);
    expect(body.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.state).toBe('idle');
    expect(registry.list()).toHaveLength(1);
    const session = registry.list()[0]!;
    expect(session.initial_prompt).toBe('build me a snake game');
    expect(session.project_root).toBe('/tmp/proj');
  });

  it('rejects empty prompt with invalid_body', async () => {
    const { status, body } = await postJSON('/api/vibe', { prompt: '' });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_body');
  });

  it('rejects missing prompt with invalid_body', async () => {
    const { status, body } = await postJSON('/api/vibe', {});
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_body');
  });

  it('accepts custom prompt timeouts', async () => {
    const { status, body } = await postJSON('/api/vibe', {
      prompt: 'test prompt',
      prompt_timeouts: { clarification_ms: 1000, permission_ms: 500 },
    });
    expect(status).toBe(200);
    const prompt = registry.emitPrompt(body.session_id, {
      subtype: 'clarification',
      question: 'q?',
    })!;
    const expiresMs = new Date(prompt.expires_at).getTime();
    const emittedMs = new Date(prompt.emitted_at).getTime();
    expect(expiresMs - emittedMs).toBeLessThanOrEqual(1100);
    expect(expiresMs - emittedMs).toBeGreaterThanOrEqual(900);
  });
});

describe('POST /api/vibe/:session_id/reply', () => {
  it('accepts a free-form reply when prompt_id matches the pending prompt', async () => {
    const startRes = await postJSON('/api/vibe', { prompt: 'test' });
    const session_id = startRes.body.session_id;
    const prompt = registry.emitPrompt(session_id, {
      subtype: 'clarification',
      question: 'q?',
    })!;
    const { status, body } = await postJSON(`/api/vibe/${session_id}/reply`, {
      prompt_id: prompt.prompt_id,
      answer: { kind: 'free_form', text: 'hello' },
    });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, accepted: true });
    expect(registry.get(session_id)!.state).toBe('running');
  });

  it('returns 404 for unknown session_id', async () => {
    const { status, body } = await postJSON('/api/vibe/nope/reply', {
      prompt_id: 'any',
      answer: { kind: 'free_form', text: 'hi' },
    });
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('session_not_found');
  });

  it('returns 409 with expected_prompt_id when prompt_id mismatches', async () => {
    const startRes = await postJSON('/api/vibe', { prompt: 'test' });
    const session_id = startRes.body.session_id;
    const prompt = registry.emitPrompt(session_id, {
      subtype: 'clarification',
      question: 'q?',
    })!;
    const { status, body } = await postJSON(`/api/vibe/${session_id}/reply`, {
      prompt_id: 'wrong-id',
      answer: { kind: 'free_form', text: 'a' },
    });
    expect(status).toBe(409);
    expect(body.error).toBe('prompt_id_mismatch');
    expect(body.expected_prompt_id).toBe(prompt.prompt_id);
  });

  it('returns 409 when session is not blocking', async () => {
    const startRes = await postJSON('/api/vibe', { prompt: 'test' });
    const session_id = startRes.body.session_id;
    const { status, body } = await postJSON(`/api/vibe/${session_id}/reply`, {
      prompt_id: 'any',
      answer: { kind: 'free_form', text: 'a' },
    });
    expect(status).toBe(409);
    expect(body.error).toBe('session_not_blocking');
  });

  it('returns 400 invalid_answer_kind when reply kind mismatches prompt', async () => {
    const startRes = await postJSON('/api/vibe', { prompt: 'test' });
    const session_id = startRes.body.session_id;
    const prompt = registry.emitPrompt(session_id, {
      subtype: 'permission',
      question: 'shell ok?',
      context: { operation: 'shell', target: 'rm -rf /' },
    })!;
    const { status, body } = await postJSON(`/api/vibe/${session_id}/reply`, {
      prompt_id: prompt.prompt_id,
      answer: { kind: 'free_form', text: 'sure' },
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_answer_kind');
  });

  it('rejects malformed body with 400 invalid_body', async () => {
    const startRes = await postJSON('/api/vibe', { prompt: 'test' });
    const session_id = startRes.body.session_id;
    const { status, body } = await postJSON(`/api/vibe/${session_id}/reply`, {
      // missing prompt_id
      answer: { kind: 'free_form', text: 'a' },
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_body');
  });

  it('handles permission reply with decision=session', async () => {
    const startRes = await postJSON('/api/vibe', { prompt: 'test' });
    const session_id = startRes.body.session_id;
    const prompt = registry.emitPrompt(session_id, {
      subtype: 'permission',
      question: 'shell ok?',
      context: { operation: 'shell', target: 'npm install' },
    })!;
    const { status } = await postJSON(`/api/vibe/${session_id}/reply`, {
      prompt_id: prompt.prompt_id,
      answer: { kind: 'permission', decision: 'session' },
    });
    expect(status).toBe(200);
    expect(registry.get(session_id)!.permission_allowlist.has('shell::npm install')).toBe(
      true,
    );
  });

  it('end-to-end: POST /api/vibe → emitPrompt → POST /reply → state.running', async () => {
    const startRes = await postJSON('/api/vibe', { prompt: 'test' });
    const session_id = startRes.body.session_id;
    expect(registry.get(session_id)!.state).toBe('idle');

    const prompt = registry.emitPrompt(session_id, {
      subtype: 'clarification',
      question: 'What goal?',
    })!;
    expect(registry.get(session_id)!.state).toBe('awaiting-reply');

    await postJSON(`/api/vibe/${session_id}/reply`, {
      prompt_id: prompt.prompt_id,
      answer: { kind: 'free_form', text: 'a snake game' },
    });
    expect(registry.get(session_id)!.state).toBe('running');
    expect(registry.get(session_id)!.pending_prompt).toBeNull();
  });
});
