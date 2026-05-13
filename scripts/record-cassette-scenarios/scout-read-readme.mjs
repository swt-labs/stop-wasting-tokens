/**
 * Cassette scenario: scout-read-readme.
 *
 * The "keystone" scenario for Phase 5 plan 05-01. A read-only Scout
 * session is asked to summarise a one-line README.md in a tmp dir. The
 * expected real-provider cost is ~$0.01 (~500 in / ~200 out tokens) per
 * docs/operations/cassette-recording.md:97-99.
 *
 * Loaded by `scripts/record-cassette.mjs` via:
 *   pnpm record -- --scenario=scout-read-readme --provider=anthropic --model=claude-sonnet-4-5
 *
 * The `run({ provider, model, apiKey })` async function below is what
 * the recorder invokes with the recording dispatcher already installed.
 *
 * ─────────────────────────────────────────────────────────────────────
 * INVARIANT (research §3.6 + docs/cli/verbs/bench.md:78-84): code in
 * this scenario must NOT import directly from `@earendil-works/*`. Use
 * `@swt-labs/runtime`'s public API. The runtime's `createSession()`
 * routes through Pi internally; the recorder catches the outbound
 * HTTP at the global undici dispatcher layer with no Pi-side awareness.
 * ─────────────────────────────────────────────────────────────────────
 *
 * **Re-recording note.** This module exposes BOTH a real-provider
 * recording entry point AND a developer-local synthetic-fixture entry
 * point (`runAgainstFixture`). The synthetic mode is intentionally
 * exposed so downstream plans / contributors can produce a
 * structurally-valid cassette during early dev without burning real
 * API tokens — but the committed `cassettes/scout-read-readme.jsonl`
 * MUST be re-recorded against the real Anthropic API before Phase 5
 * closes (the synthetic body has no semantic content). See
 * `docs/operations/cassette-recording.md` for the re-record procedure.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Real-provider entry point. Invoked by scripts/record-cassette.mjs.
 *
 * Spins up a tmp project containing a single README.md, constructs an
 * `@swt-labs/runtime` session with read-only tools (Read/Grep/Glob),
 * issues one prompt asking for a one-sentence summary, and awaits
 * completion. The recorder's installed dispatcher captures the
 * outbound `/v1/messages` traffic in real time.
 *
 * Throws if the runtime's session API has drifted from this shape —
 * we deliberately do NOT silently fall back to a synthetic recording
 * when the real one is wanted.
 */
export async function run({ provider, model, apiKey }) {
  if (!apiKey) {
    throw new Error(
      'scout-read-readme: missing apiKey. Set ANTHROPIC_API_KEY (or the matching ENV) before running `pnpm record`.',
    );
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'swt-rec-scout-'));
  writeFileSync(
    join(tmpRoot, 'README.md'),
    '# Sample Project\n\nA tiny project for cassette-recording tests.\n',
  );

  try {
    // Dynamic import so this module loads cleanly even if the
    // recorder is invoked in a partial-build state (e.g., before
    // `pnpm build` has compiled the runtime).
    const runtime = await import('@swt-labs/runtime');
    const session = await runtime.createSession({
      cwd: tmpRoot,
      ephemeral: true,
      meterContext: {
        role: 'scout',
        tier: 'fast',
      },
    });

    // The runtime's `prompt()` returns an async iterable of events.
    // We drain it so the recorder captures the full request/response
    // round-trip; the prompt content is intentionally short to keep
    // the recording cost ~$0.01 per the plan budget.
    void provider;
    void model;
    const events = session.prompt(
      'Read README.md in this directory. In one sentence, what does this project do? Reply with just the sentence.',
    );

    if (events && typeof events[Symbol.asyncIterator] === 'function') {
      for await (const _evt of events) {
        // drain; recorder is observing on the wire
      }
    } else if (events instanceof Promise) {
      await events;
    }

    if (typeof session.dispose === 'function') {
      await session.dispose();
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

/**
 * Synthetic-fixture entry point for dev-only smoke recordings.
 *
 * Does NOT require an API key. Hits a caller-provided URL that
 * mimics Anthropic's `/v1/messages` SSE shape. The recorder treats
 * the traffic identically — header + interactions land in the JSONL
 * with `cwd_redacted: true` and monotonic seq.
 *
 * The committed `cassettes/scout-read-readme.jsonl` was produced
 * via this entry point as a placeholder; it MUST be re-recorded
 * against the real Anthropic API before Phase 5 closes (see the
 * module docstring above + docs/operations/cassette-recording.md).
 */
export async function runAgainstFixture({ baseUrl, headers = {} }) {
  const { fetch } = await import('undici');
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const body = {
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content:
          'Read README.md in this directory. In one sentence, what does this project do? Reply with just the sentence.',
      },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  // Drain SSE / JSON response.
  if (res.body) {
    const reader = res.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  }
}
