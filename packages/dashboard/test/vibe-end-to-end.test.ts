import { afterEach, describe, expect, it } from 'vitest';

import { createServer, type DashboardServer } from '../src/server/index.js';
import { ScriptedAgent } from '../src/server/vibe/methodology-agent.js';

interface ParsedSse {
  event?: string;
  data?: string;
}

function parseSseChunk(chunk: string): ParsedSse[] {
  const blocks = chunk.split(/\n\n/);
  const parsed: ParsedSse[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const out: ParsedSse = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) out.event = line.slice(6).trim();
      else if (line.startsWith('data:')) out.data = (out.data ?? '') + line.slice(5).trim();
    }
    if (out.event || out.data) parsed.push(out);
  }
  return parsed;
}

async function readUntilEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  matcher: (evt: ParsedSse) => boolean,
  timeoutMs: number,
): Promise<ParsedSse> {
  const decoder = new TextDecoder();
  const start = Date.now();
  let buffer = '';
  while (Date.now() - start < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - start);
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), Math.max(remaining, 1)),
      ),
    ]);
    if (done) break;
    if (value) buffer += decoder.decode(value, { stream: true });
    for (const evt of parseSseChunk(buffer)) {
      if (matcher(evt)) return evt;
    }
  }
  throw new Error(
    `SSE matcher did not fire within ${timeoutMs}ms; buffer: ${buffer.slice(0, 300)}`,
  );
}

describe('vibe end-to-end through HTTP + SSE + ScriptedAgent', () => {
  let server: DashboardServer | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('POST /api/vibe → ScriptedAgent emits ASK_USER → SSE event → POST /reply → loop completes', async () => {
    // Open SSE FIRST (firehose, no session_id filter — we don't know the id
    // yet) so we don't race the loop's prompt emission. The session.created
    // event arrives BEFORE agent.prompt because both flow through the same
    // bus; opening SSE first guarantees we see both.
    server = await createServer({
      port: 0,
      agentFactory: () =>
        new ScriptedAgent({
          script: [
            {
              type: 'ask',
              request: { subtype: 'clarification', question: 'What goal?' },
            },
            { type: 'stdout', line: 'building...' },
            { type: 'complete', text: 'done' },
          ],
          // Tiny delay so the SSE open finishes before the loop emits the prompt.
          step_delay_ms: 25,
        }),
    });
    const base = `http://${server.hostname}:${server.port}`;

    const sseRes = await fetch(`${base}/api/events`, {
      headers: { accept: 'text/event-stream' },
    });
    const reader = sseRes.body!.getReader();

    try {
      // Give the SSE handler a moment to subscribe.
      await new Promise((r) => setTimeout(r, 25));

      const startRes = await fetch(`${base}/api/vibe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'build me a snake game' }),
      });
      expect(startRes.status).toBe(200);
      const startJson = (await startRes.json()) as { session_id: string };
      const sessionId = startJson.session_id;

      const promptEvt = await readUntilEvent(reader, (e) => e.event === 'agent.prompt', 1000);
      const promptData = JSON.parse(promptEvt.data ?? '{}') as {
        prompt_id: string;
        question: string;
        session_id: string;
      };
      expect(promptData.question).toBe('What goal?');
      expect(promptData.session_id).toBe(sessionId);

      const replyRes = await fetch(`${base}/api/vibe/${sessionId}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt_id: promptData.prompt_id,
          answer: { kind: 'free_form', text: 'a snake game' },
        }),
      });
      expect(replyRes.status).toBe(200);

      // Poll registry until the loop finishes.
      const registry = server.vibeRegistry;
      const start = Date.now();
      while (Date.now() - start < 1000) {
        const session = registry.get(sessionId);
        if (session?.state === 'completed') return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(
        `session did not reach completed state; current=${registry.get(sessionId)?.state}`,
      );
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  });

  it('two concurrent sessions do not cross-contaminate prompts', async () => {
    // Each call to agentFactory builds an independent ScriptedAgent so the
    // two sessions interleave their asks/replies without sharing state.
    server = await createServer({
      port: 0,
      agentFactory: ({ prompt }) =>
        new ScriptedAgent({
          script: [
            {
              type: 'ask',
              request: { subtype: 'clarification', question: `Q for ${prompt}` },
            },
            { type: 'complete' },
          ],
        }),
    });
    const base = `http://${server.hostname}:${server.port}`;
    const registry = server.vibeRegistry;

    const startA = await fetch(`${base}/api/vibe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'session-A' }),
    });
    const startB = await fetch(`${base}/api/vibe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'session-B' }),
    });
    const sessionA = ((await startA.json()) as { session_id: string }).session_id;
    const sessionB = ((await startB.json()) as { session_id: string }).session_id;
    expect(sessionA).not.toBe(sessionB);

    // Wait for both sessions to have pending prompts.
    await waitFor(
      () =>
        registry.get(sessionA)?.pending_prompt !== null &&
        registry.get(sessionB)?.pending_prompt !== null,
      500,
    );

    const promptA = registry.get(sessionA)?.pending_prompt;
    const promptB = registry.get(sessionB)?.pending_prompt;
    if (!promptA || !promptB) throw new Error('expected pending prompts in both sessions');
    expect(promptA.prompt_id).not.toBe(promptB.prompt_id);
    expect(promptA.question).toBe('Q for session-A');
    expect(promptB.question).toBe('Q for session-B');

    // A reply targeting session-A must NOT resolve session-B.
    const replyA = await fetch(`${base}/api/vibe/${sessionA}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: promptA.prompt_id,
        answer: { kind: 'free_form', text: 'answer-A' },
      }),
    });
    expect(replyA.status).toBe(200);

    // session-B should still be awaiting reply.
    const sessionBState = registry.get(sessionB);
    expect(sessionBState?.state).toBe('awaiting-reply');
    expect(sessionBState?.pending_prompt?.prompt_id).toBe(promptB.prompt_id);

    // Trying to reply to session-A again with session-B's prompt_id must fail
    // with prompt_id_mismatch — proves cross-session prompt_ids don't leak.
    const wrongRes = await fetch(`${base}/api/vibe/${sessionA}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: promptB.prompt_id,
        answer: { kind: 'free_form', text: 'cross-session' },
      }),
    });
    expect(wrongRes.status).toBe(409);
    const wrongJson = (await wrongRes.json()) as { error: string };
    expect(wrongJson.error).toBe('session_not_blocking');

    // Finally complete session-B.
    const replyB = await fetch(`${base}/api/vibe/${sessionB}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: promptB.prompt_id,
        answer: { kind: 'free_form', text: 'answer-B' },
      }),
    });
    expect(replyB.status).toBe(200);

    await waitFor(
      () =>
        registry.get(sessionA)?.state === 'completed' &&
        registry.get(sessionB)?.state === 'completed',
      500,
    );
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
