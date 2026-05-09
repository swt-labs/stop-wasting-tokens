import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerCommandRoute } from '../src/server/routes/command.ts';

let app: Hono;

beforeEach(() => {
  app = new Hono();
  // cwd doesn't matter for routing-only tests; only the spawn path uses it,
  // and we never let interactive/unknown verbs reach the spawn.
  registerCommandRoute(app, process.cwd());
});

afterEach(() => {
  app = new Hono(); // GC reset
});

async function postCommand(input: string): Promise<{ status: number; body: any }> {
  const res = await app.request('/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /api/command — routing decisions', () => {
  it('rejects interactive verbs with rejected_interactive (no spawn)', async () => {
    const { status, body } = await postCommand('vibe');
    expect(status).toBe(200);
    expect(body.routing_decision).toBe('rejected_interactive');
    expect(body.verb).toBe('vibe');
    expect(body.ok).toBe(false);
    expect(body.exit_code).toBe(2);
    expect(body.duration_ms).toBe(0); // no spawn occurred
    expect(body.stderr).toContain('interactive');
    expect(body.stderr).toContain('terminal');
  });

  it('rejects watch with rejected_interactive', async () => {
    const { body } = await postCommand('watch');
    expect(body.routing_decision).toBe('rejected_interactive');
    expect(body.verb).toBe('watch');
  });

  it('rejects dashboard with rejected_interactive', async () => {
    const { body } = await postCommand('dashboard');
    expect(body.routing_decision).toBe('rejected_interactive');
    expect(body.verb).toBe('dashboard');
  });

  it('rejects stub verbs with rejected_unknown', async () => {
    const { status, body } = await postCommand('init');
    expect(status).toBe(200);
    expect(body.routing_decision).toBe('rejected_unknown');
    expect(body.verb).toBe('init');
    expect(body.ok).toBe(false);
    expect(body.exit_code).toBe(2);
    expect(body.duration_ms).toBe(0);
    expect(body.stderr).toContain('unknown command');
    expect(body.stderr).toContain('help, status, doctor');
  });

  it('rejects natural-language input with rejected_unknown', async () => {
    const { body } = await postCommand("i'd like you to create a fake README");
    expect(body.routing_decision).toBe('rejected_unknown');
    expect(body.verb).toBe("i'd");
  });

  it('rejects empty input with 400', async () => {
    const res = await app.request('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: '   ' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('empty_input');
  });

  it('rejects invalid body with 400', async () => {
    const res = await app.request('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrongField: 'oops' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_body');
  });

  it('lowercases first token before classification (case-insensitive)', async () => {
    // VIBE in caps still routes to rejected_interactive
    const upper = await postCommand('VIBE');
    expect(upper.body.routing_decision).toBe('rejected_interactive');
    expect(upper.body.verb).toBe('vibe'); // lowercased
  });
});
