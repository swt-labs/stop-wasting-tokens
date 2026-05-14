/**
 * Cassette scenario: snake-milestone.
 *
 * The REQ-12 anti-empty-`PLAN.md` canary fixture cassette (Phase 5
 * plan 05-03). Runs `swt cook` end-to-end against a tmp copy of
 * `packages/test-utils/golden/snake/spec/` and captures every LLM
 * round-trip across the full milestone (scope → discuss → plan →
 * execute → verify → archive). Expected real-provider cost is
 * $2-$5 + 30-60 min per `docs/operations/cassette-recording.md` and
 * Phase 5 plan 05-03's budget.
 *
 * Loaded by `scripts/record-cassette.mjs` via:
 *   pnpm record -- --scenario=snake-milestone \
 *     --provider=anthropic --model=claude-sonnet-4-5
 *
 * Output cassette path (in keeping with the golden-fixture layout):
 *   packages/test-utils/golden/snake/cassettes/milestone.jsonl
 *
 * NOTE: `scripts/record-cassette.mjs` writes to
 * `packages/test-utils/cassettes/{scenario}.jsonl`; for this scenario
 * the developer must move the produced JSONL into the snake fixture
 * directory after recording, OR pass an explicit outputPath when
 * driving `record()` from a custom driver. See the
 * `runWithOutputPath()` helper below.
 *
 * ─────────────────────────────────────────────────────────────────────
 * **DEVN-03 (Phase 5 plan 05-03):** The committed
 * `golden/snake/cassettes/milestone.jsonl` is a SYNTHETIC cassette
 * recorded against a local Anthropic-shaped SSE generator (see
 * `generateSyntheticCassette()` below), NOT against the real Anthropic
 * API. Cause: no `ANTHROPIC_API_KEY` available on the recording
 * machine for this commit (matches DEVN-02 from plan 05-01). The
 * cassette is structurally valid against
 * `CassetteHeaderSchema` + `CassetteInteractionSchema`. It MUST be
 * re-recorded against the real Anthropic API before Phase 5 closes —
 * the `run()` entry point below is the production path.
 *
 * **DEVN-04 (Phase 5 plan 05-03):** The cook-handler invocation in
 * `run()` uses a `cookHandler({ cwd, nonInteractive })` shape that does
 * NOT yet exist in `packages/cli/src/commands/cook.ts` —
 * cook.ts's `cookHandler` is a `CommandHandler(parsed, io)` function.
 * Plan 05-04 owns the runVibe → cook bridge that exposes the
 * `({cwd, nonInteractive})` shape end-to-end. Until then, the `run()`
 * function below documents the contract; the synthetic-cassette path
 * (`generateSyntheticCassette()`) is what plan 05-03's canary replays.
 * ─────────────────────────────────────────────────────────────────────
 */

import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..');
const SPEC_DIR = join(REPO_ROOT, 'packages', 'test-utils', 'golden', 'snake', 'spec');

/**
 * Real-provider entry point. Invoked by scripts/record-cassette.mjs.
 *
 * Spins up a tmp project containing a copy of golden/snake/spec/,
 * drives `swt cook` end-to-end (non-interactive), and lets the
 * recorder's installed dispatcher capture every outbound LLM
 * round-trip.
 *
 * Throws if no API key — record-cassette.mjs already enforces this,
 * but we double-check here so a programmatic caller fails loud.
 */
export async function run({ provider, model, apiKey }) {
  if (!apiKey) {
    throw new Error(
      'snake-milestone: missing apiKey. Set ANTHROPIC_API_KEY (or the matching ENV) before running `pnpm record`.',
    );
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'swt-rec-snake-milestone-'));
  cpSync(SPEC_DIR, tmpRoot, { recursive: true });

  // Non-interactive mode so cook drives autonomously through all 6
  // phases. Plan 05-04 owns the runVibe → cook bridge that exposes the
  // `({cwd, nonInteractive})` shape end-to-end; until then this scenario
  // documents the contract.
  process.env['SWT_FORCE_NON_INTERACTIVE'] = '1';
  process.env['SWT_PLANNING_ROOT'] = join(tmpRoot, '.swt-planning');

  try {
    // Dynamic import so this module loads cleanly even if the runtime/
    // CLI has not been fully built yet — the recorder is observe-only
    // on the wire.
    const cookModule = await import('@swt-labs/cli/commands/cook');
    const cookFn = cookModule.cookHandler ?? cookModule.default;
    if (typeof cookFn !== 'function') {
      throw new Error(
        'snake-milestone: @swt-labs/cli/commands/cook does not export a callable cookHandler. ' +
          'Plan 05-04 must land the runVibe → cook bridge before real recording can drive cookHandler ' +
          'with a {cwd, nonInteractive} shape.',
      );
    }
    void provider;
    void model;
    await cookFn({ cwd: tmpRoot, nonInteractive: true });
  } finally {
    delete process.env['SWT_FORCE_NON_INTERACTIVE'];
    delete process.env['SWT_PLANNING_ROOT'];
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

/**
 * Synthetic-fixture entry point for dev-only smoke recordings.
 *
 * Mirrors the `runAgainstFixture` shape from
 * scripts/record-cassette-scenarios/scout-read-readme.mjs. Does NOT
 * require an API key. The committed `milestone.jsonl` was produced via
 * `generateSyntheticCassette()` (NOT this function) as a structurally
 * valid placeholder; see the module docstring for the re-record
 * procedure.
 */
export async function runAgainstFixture({ baseUrl, headers = {} }) {
  const { fetch } = await import('undici');
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const body = {
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content:
          'Read PROJECT.md and REQUIREMENTS.md. Produce a PLAN.md with ≥3 tasks per the snake-milestone fixture.',
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
  if (res.body) {
    const reader = res.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Synthetic cassette generator — DEVN-03
//
// Writes a structurally-valid JSONL cassette covering the snake
// milestone shape (one synthetic Anthropic SSE interaction per role:
// scout → architect → lead → dev → qa → docs). The body_hash values
// are deterministic SHA-256 of canonicalised stub request bodies so
// `loadCassette()` validates and replay can match if a caller wishes
// to drive the canary against the synthetic shape (the canary itself
// gates real end-to-end replay behind a guard — see snake-canary.test).
// ────────────────────────────────────────────────────────────────────────

/**
 * Six synthetic roles spanning the snake milestone. Each one produces
 * one interaction in the cassette. The order matches the v3 SDLC
 * sequence: scope → discuss → plan → execute → verify → archive.
 */
const SYNTHETIC_ROLES = [
  {
    role: 'scout',
    summary:
      'Read PROJECT.md + REQUIREMENTS.md. Five P0 requirements identified; surface area is snake/__main__.py + snake/game.py + tests/test_game.py + pyproject.toml.',
  },
  {
    role: 'architect',
    summary:
      'Recommend splitting curses-bound rendering (snake/__main__.py) from pure state machine (snake/game.py) per REQ-04. Use python-testing-patterns skill for the test suite (REQ-05).',
  },
  {
    role: 'lead',
    summary:
      'PLAN.md emitted with 3 tasks: T1 implement Game state machine, T2 implement curses runner, T3 author pytest suite. skills_used: [python-testing-patterns].',
  },
  {
    role: 'dev',
    summary:
      'Implemented snake/game.py (Game.step + GameState dataclass), snake/__main__.py (curses loop), tests/test_game.py (5 tests: spawn, move, grow, wall_collision, self_collision).',
  },
  {
    role: 'qa',
    summary:
      'pytest tests/ → 5 passed, 0 failed. REQ-04 verified via from snake.game import Game; REQ-05 verified via ≥4 PASSED lines. Curses (REQ-01/02/03) deferred to manual-check.',
  },
  {
    role: 'docs',
    summary:
      'Archive: SUMMARY.md written, ROADMAP.md updated, STATE.md set to "milestone complete". Phase 01-foundation closed.',
  },
];

/**
 * Build one Anthropic-shaped SSE response payload as a 6-chunk
 * body_chunks array, matching the structure of the
 * scout-read-readme.jsonl committed in plan 05-01.
 */
function syntheticResponseChunks(messageId, text, outputTokens) {
  return [
    `event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4-5',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 32, output_tokens: 1 },
      },
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({
      type: 'content_block_stop',
      index: 0,
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({
      type: 'message_stop',
    })}\n\n`,
  ];
}

function syntheticBodyHash(role, summary) {
  // Deterministic SHA-256 over a canonical stub. The hash is what the
  // replayer matches on; we don't claim this is the body the real
  // recording will produce — DEVN-03 documents the synthetic origin.
  const canonical = JSON.stringify({ role, summary, schema: 'snake-milestone-v1' });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * Produce a structurally-valid synthetic milestone cassette at
 * `outputPath`. The cassette is committed to
 * `packages/test-utils/golden/snake/cassettes/milestone.jsonl` per
 * plan 05-03 T2; this helper is what produced that committed file.
 *
 * Re-running this against the same path overwrites. Real recording
 * via `run({apiKey})` is the production path — see module docstring.
 */
export function generateSyntheticCassette(outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const header = {
    schema_version: 1,
    type: 'header',
    name: 'snake-milestone',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    recorded_at: new Date('2026-05-13T18:00:00.000Z').toISOString(),
    cwd_redacted: true,
  };
  writeFileSync(outputPath, JSON.stringify(header) + '\n');

  let seq = 0;
  for (const { role, summary } of SYNTHETIC_ROLES) {
    seq += 1;
    const interaction = {
      schema_version: 1,
      type: 'interaction',
      seq,
      request: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers_normalized: {
          accept: '*/*',
          'accept-encoding': 'br, gzip, deflate',
          'accept-language': '*',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'sec-fetch-mode': 'cors',
          'user-agent': 'undici',
        },
        body_hash: syntheticBodyHash(role, summary),
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'anthropic-version': '2023-06-01',
          date: 'Wed, 13 May 2026 18:00:00 GMT',
          connection: 'keep-alive',
          'keep-alive': 'timeout=5',
          'transfer-encoding': 'chunked',
        },
        body_chunks: syntheticResponseChunks(
          `msg_synthetic_${role}`,
          summary,
          Math.max(8, Math.ceil(summary.length / 4)),
        ),
      },
    };
    appendFileSync(outputPath, JSON.stringify(interaction) + '\n');
  }
}

/**
 * Convenience entry: regenerate the committed milestone.jsonl in
 * place. Invoked from the repo root as:
 *   node scripts/record-cassette-scenarios/snake-milestone.mjs --generate-synthetic
 */
const __thisFile = fileURLToPath(import.meta.url);
const __mainFile = process.argv[1] ? (await import('node:path')).resolve(process.argv[1]) : '';
if (__thisFile === __mainFile && process.argv.includes('--generate-synthetic')) {
  const outputPath = join(
    REPO_ROOT,
    'packages',
    'test-utils',
    'golden',
    'snake',
    'cassettes',
    'milestone.jsonl',
  );
  generateSyntheticCassette(outputPath);
  console.log(`snake-milestone: synthetic cassette written → ${outputPath}`);
}
