/**
 * Phase 02 / Plan 02-01 Task 5 — End-to-end roundtrip for the
 * dashboard cook bar's scope-seed pipeline.
 *
 * Two complementary contract tests in one file:
 *
 *   A/B. Two-sided fake askUser roundtrip across a REAL Hono daemon
 *        (createServer({port: 0})). The orchestrator side calls the
 *        real `askUser(...)` from @swt-labs/runtime with
 *        `dashboardHost`/`dashboardPort` pointing at the test server;
 *        the dashboard side polls GET /api/prompts/pending until the
 *        prompt appears, then POSTs to /api/prompts/:id/respond. The
 *        floating askUser() promise must resolve with the matching
 *        payload — proving the SSE-streaming reply path in
 *        ask-user.ts:324–389 works against the production prompts
 *        route.
 *
 *   C.  Idempotency of the new swt_complete_scope_seed Pi custom tool.
 *        Uses a tmpdir-rooted project; drops a fake
 *        `.swt-planning/.pending-scope-idea.txt`; invokes the tool's
 *        captured execute() twice. First call deletes the file; second
 *        call MUST NOT throw (ENOENT swallowed).
 *
 * Hermetic by construction:
 *   - No API key required (no LLM in the loop — askUser is exercised
 *     directly against the dashboard).
 *   - No real Pi session needed for Test C (we drive the registered
 *     execute() callback directly via a stub PiExtensionAPI).
 *   - Each test runs in <5s; whole file completes well under the
 *     vitest default budget.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  askUser,
  buildSwtCompleteScopeSeedExtension,
  SWT_COMPLETE_SCOPE_SEED_TOOL_NAME,
  type PiExtensionAPI,
  type PiToolDefinition,
} from '@swt-labs/runtime';
import type { PromptRequestEvent } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServer, type DashboardServer } from '../src/server/index.js';
import { __resetPendingPromptsForTest } from '../src/server/routes/prompts.js';

/**
 * Poll GET /api/prompts/pending until a prompt with the given session_id
 * appears, or `timeoutMs` elapses. The polling interval is short (25ms)
 * so the floating askUser() promise resolves quickly once the test
 * "dashboard side" responds.
 */
async function waitForPendingPrompt(
  base: string,
  sessionId: string,
  timeoutMs: number,
): Promise<PromptRequestEvent> {
  const startTs = Date.now();
  while (Date.now() - startTs < timeoutMs) {
    const res = await fetch(`${base}/api/prompts/pending`);
    if (res.ok) {
      const body = (await res.json()) as { pending: PromptRequestEvent[] };
      const match = body.pending.find((p) => p.session_id === sessionId);
      if (match) return match;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `waitForPendingPrompt: timed out after ${timeoutMs}ms waiting for session_id=${sessionId}`,
  );
}

describe('e2e: askUser ↔ /api/prompts/* roundtrip (Phase 02)', () => {
  let server: DashboardServer | undefined;

  beforeEach(async () => {
    __resetPendingPromptsForTest();
    server = await createServer({ port: 0, skipSnapshotter: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    __resetPendingPromptsForTest();
  });

  it('choice answer: askUser publishes → fake-dashboard responds → promise resolves with selectedOption', async () => {
    if (!server) throw new Error('server not started');
    const base = `http://${server.hostname}:${server.port}`;
    const sessionId = 'test-scope-choice';

    // Fake-cook side: floating askUser call that publishes a prompt and
    // waits on the SSE stream for a matching prompt.response.
    const answerPromise = askUser(
      {
        header: 'Phase 02 scope-seed test (choice)',
        question: 'Which framework?',
        options: [
          { label: 'Solid', isRecommended: true },
          { label: 'React' },
        ],
      },
      {
        dashboardHost: server.hostname,
        dashboardPort: server.port,
        sessionId,
      },
    );

    // Fake-dashboard side: poll the pending list, then POST a response.
    const pending = await waitForPendingPrompt(base, sessionId, 2000);
    const respondRes = await fetch(`${base}/api/prompts/${encodeURIComponent(pending.prompt_id)}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: pending.prompt_id,
        selectedOption: 'Solid',
        freeform: null,
      }),
    });
    expect(respondRes.status).toBe(200);

    // The orchestrator's floating askUser() resolves with the
    // {selectedOption, freeform} shape per ask-user.ts:113–115.
    const answer = await answerPromise;
    expect(answer).toEqual({ selectedOption: 'Solid', freeform: null });
  }, 5_000);

  it('freeform answer: askUser publishes → fake-dashboard responds freeform → promise resolves with freeform text', async () => {
    if (!server) throw new Error('server not started');
    const base = `http://${server.hostname}:${server.port}`;
    const sessionId = 'test-scope-freeform';

    const answerPromise = askUser(
      {
        header: 'Phase 02 scope-seed test (freeform)',
        question: 'What do you want to build?',
        options: [{ label: 'a snake game', isRecommended: true }, { label: 'Other' }],
      },
      {
        dashboardHost: server.hostname,
        dashboardPort: server.port,
        sessionId,
      },
    );

    const pending = await waitForPendingPrompt(base, sessionId, 2000);
    const freeformText = 'a snake game in Solid with high-score tracking';
    const respondRes = await fetch(`${base}/api/prompts/${encodeURIComponent(pending.prompt_id)}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: pending.prompt_id,
        selectedOption: null,
        freeform: freeformText,
      }),
    });
    expect(respondRes.status).toBe(200);

    const answer = await answerPromise;
    expect(answer).toEqual({ selectedOption: null, freeform: freeformText });
  }, 5_000);
});

describe('swt_complete_scope_seed: idempotent filesystem effect (Phase 02)', () => {
  let tmpRoot: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(joinPath(tmpdir(), 'scope-seed-'));
  });

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  it('execute() deletes the seed file on first call; second call swallows ENOENT', async () => {
    if (!tmpRoot) throw new Error('tmpRoot not set up');

    // Drop a fake seed file at the canonical path so the factory's
    // closure-captured seedPath resolves against an existing file.
    const planningDir = joinPath(tmpRoot, '.swt-planning');
    mkdirSync(planningDir, { recursive: true });
    const seedPath = joinPath(planningDir, '.pending-scope-idea.txt');
    writeFileSync(seedPath, 'build a snake game\n', 'utf8');
    expect(existsSync(seedPath)).toBe(true);

    // Build the extension and capture the registered tool definition by
    // stubbing PiExtensionAPI. The factory closure calls
    // pi.registerTool({...}) exactly once at session start; we grab the
    // definition out of the call and drive its execute() directly.
    let captured: PiToolDefinition<unknown> | undefined;
    const piStub: PiExtensionAPI = {
      registerTool: (def: PiToolDefinition<unknown>): void => {
        captured = def;
      },
      on: () => {
        /* not used by this tool */
      },
      appendEntry: () => {
        /* not used by this tool */
      },
    };

    const factory = buildSwtCompleteScopeSeedExtension({ projectRoot: tmpRoot });
    factory(piStub);

    expect(captured).toBeDefined();
    expect(captured?.name).toBe(SWT_COMPLETE_SCOPE_SEED_TOOL_NAME);

    if (!captured) throw new Error('tool definition was not captured');

    // First call: deletes the file, returns {ok: true}.
    const ctx = { cwd: tmpRoot, sessionManager: { getEntries: () => [] } };
    const first = await captured.execute(
      'call-1',
      {},
      undefined,
      undefined,
      ctx,
    );
    expect(existsSync(seedPath)).toBe(false);
    expect(first.content).toEqual([{ type: 'text', text: 'seed file deleted' }]);
    expect(first.details).toEqual({ ok: true });

    // Second call on the already-gone file: MUST NOT throw, MUST return
    // the same shape (idempotency contract — ENOENT swallowed).
    const second = await captured.execute(
      'call-2',
      {},
      undefined,
      undefined,
      ctx,
    );
    expect(existsSync(seedPath)).toBe(false);
    expect(second.content).toEqual([{ type: 'text', text: 'seed file deleted' }]);
    expect(second.details).toEqual({ ok: true });
  }, 5_000);
});
