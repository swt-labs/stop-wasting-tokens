/**
 * Plan 01-05 (Phase 1) — Pi-substrate primitive 2: `swt:askUser`.
 *
 * Dashboard-mediated structured prompt with a readline-based headless
 * fallback. Resolves a Promise with `{ selectedOption, freeform }` once the
 * user replies (via dashboard click, TTY input, or the non-TTY auto-accept
 * path).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  ORCHESTRATOR-ONLY INVARIANT (READ BEFORE EXTENDING THIS MODULE)       ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 *   `swt:askUser` is registered as a Pi custom tool (`swt_ask_user`) ONLY on
 *   the orchestrator session — NEVER on dev/qa/scout/lead/architect/debugger/
 *   docs sessions. This invariant is enforced at THREE layers:
 *
 *     1. spawnAgent's tool-list construction (plan 01-01,
 *        packages/orchestration/src/spawn-agent.ts) — the `customTools[]`
 *        derived from role+extensions never includes `swt_ask_user`.
 *     2. The mechanical regression test in
 *        `packages/runtime/test/ask-user/ask-user.test.ts` (plan 01-05
 *        task 5, assertion A.6) iterates `AGENT_ROLES` and asserts the
 *        invariant for every role, including the late-added `'docs'`.
 *     3. Documentation in this file's header + spawn-agent.ts's
 *        "CRITICAL" comment block.
 *
 *   This module exposes the *raw* askUser function; the Pi custom-tool
 *   bridge that exposes it as `swt_ask_user` on the orchestrator session
 *   lives in a Phase 3 wiring follow-up (NOT here).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * IPC contract (research §5):
 *
 *   1. Health check — `fetch('http://{host}:{port}/api/health', {signal:
 *      AbortSignal.timeout(100)})`. Non-200 / network error / timeout =
 *      fall to headless.
 *   2. Primary publish — `POST /api/prompts/publish` with the prompt.request
 *      event body (generated `prompt_id = crypto.randomUUID()`).
 *   3. Response wait — open SSE to `/api/events?session_id={sessionId}` and
 *      poll for a `prompt.response` event whose `prompt_id` matches.
 *   4. Resolve with `{ selectedOption, freeform }`.
 *
 * Headless fallback (research §2 primitive 2):
 *
 *   - TTY: render header + numbered options via `node:readline/promises`,
 *     read selection, prompt for freeform if "Other" picked.
 *   - non-TTY: auto-accept the option with `isRecommended === true` (or the
 *     first option if none is recommended), log `[auto-accept: "..."]` to
 *     stderr, resolve immediately. Required for CI / piped invocation.
 *
 * Phase D upgrade: the SSE+REST transport swaps for a Unix domain socket at
 * `.swt-planning/.cook.sock`. The payload shape is identical so this API
 * surface is forward-compatible.
 *
 * No Ink / React dependency — readline is sufficient.
 */

import { randomUUID } from 'node:crypto';
import * as readline from 'node:readline/promises';

import type { PromptRequestEvent, PromptResponseEvent } from '@swt-labs/shared';

const DEFAULT_DASHBOARD_HOST = '127.0.0.1';
const DEFAULT_DASHBOARD_PORT = 54321;
// Plan 01-05: 100ms health-check timeout per the must_haves truth #2. Any
// slower would punish users on cold caches where the dashboard is genuinely
// up; any faster and we'd see false negatives on busy laptops.
const HEALTH_CHECK_TIMEOUT_MS = 100;
// 10-minute default for the dashboard wait — matches the AskUserQuestion
// contract's "human in the loop" patience. Callers can override.
const DEFAULT_RESPONSE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Single option in an `askUser` prompt. `isRecommended: true` flags the
 * option that the headless non-TTY fallback auto-accepts (research §2
 * primitive 2 fallback option d). At most one option should be marked
 * recommended; if multiple are flagged, the first one wins.
 */
export interface AskUserOption {
  /** Display label rendered as a card button (dashboard) or `[N] label` (TTY). */
  readonly label: string;
  /** When true, this option is the headless-fallback auto-accept choice. */
  readonly isRecommended?: boolean;
}

/**
 * Public askUser payload. Mirrors the prompt.request SnapshotEvent shape
 * minus the routing fields (session_id / prompt_id are injected by askUser
 * before the publish hop).
 */
export interface AskUserQuestion {
  /** Short header rendered above the question (optional per references/ask-user-question.md). */
  readonly header?: string;
  /** The actual question text. Must be non-empty. */
  readonly question: string;
  /** Structured choices. 1–4 is the sweet spot per the contract. */
  readonly options: ReadonlyArray<AskUserOption>;
  /** When true, dashboard renders checkboxes instead of radio buttons. */
  readonly multiSelect?: boolean;
  /** Optional preview body (e.g., a diff or rendered output) shown alongside the question. */
  readonly preview?: string | null;
}

/**
 * Resolved askUser response. Exactly one of `selectedOption` and `freeform`
 * is non-null — the dashboard / TTY surface uses the discriminator to decide
 * whether the user picked a structured option or wrote freeform text.
 */
export interface AskUserResponse {
  readonly selectedOption: string | null;
  readonly freeform: string | null;
}

/**
 * Options for askUser. Production callers usually only set `sessionId`; tests
 * inject `dashboardHost` / `dashboardPort` to point at a temp server.
 */
export interface AskUserOptions {
  /** Dashboard host. Default 127.0.0.1. */
  readonly dashboardHost?: string;
  /** Dashboard port. Default 54321 (matches DEFAULT_PORT in the dashboard server). */
  readonly dashboardPort?: number;
  /** Session id stamped into prompt.request events. Default: randomUUID(). */
  readonly sessionId?: string;
  /** Max wait for a prompt.response. Default: 10 minutes. */
  readonly timeoutMs?: number;
  /**
   * Override the standard input source. Tests inject a mock; production
   * callers omit. The default reads from process.stdin.
   */
  readonly stdin?: NodeJS.ReadableStream;
  /**
   * Override stdout for prompt rendering. Default: process.stdout.
   */
  readonly stdout?: NodeJS.WritableStream;
  /**
   * Override stderr for the auto-accept log line. Default: process.stderr.
   */
  readonly stderr?: NodeJS.WritableStream;
  /**
   * Override the TTY check. When omitted, defaults to inspecting
   * `process.stdout.isTTY`. Tests pass `false` to force the auto-accept
   * branch deterministically.
   */
  readonly isTTY?: boolean;
  /**
   * Test seam — override the `fetch` used for the dashboard reachability +
   * publish + SSE hops. Defaults to the global `fetch`. Production callers
   * never set this.
   */
  readonly fetch?: typeof fetch;
}

/**
 * Validate the inbound question. Empty options arrays are a contract bug,
 * not a runtime fallback case — fail loudly so the caller fixes the prompt
 * rather than the user being stuck at an empty menu.
 */
function assertValidQuestion(q: AskUserQuestion): void {
  if (typeof q.question !== 'string' || q.question.trim().length === 0) {
    throw new Error('askUser: question must be a non-empty string.');
  }
  if (!Array.isArray(q.options) || q.options.length === 0) {
    throw new Error(
      'askUser: options must be a non-empty array. ' +
        'Use intentional freeform (a separate primitive) when the choice space is unbounded.',
    );
  }
  for (const opt of q.options) {
    if (typeof opt.label !== 'string' || opt.label.trim().length === 0) {
      throw new Error('askUser: every option must have a non-empty label.');
    }
  }
}

/**
 * Pick the auto-accept option for the non-TTY fallback. First match on
 * `isRecommended === true`; otherwise the first option in the list.
 */
function pickAutoAcceptOption(q: AskUserQuestion): AskUserOption {
  const recommended = q.options.find((opt) => opt.isRecommended === true);
  return recommended ?? q.options[0]!;
}

/**
 * Probe the dashboard's health endpoint with a 100ms budget. Returns true
 * iff the server replies with a 200 within the window.
 */
async function dashboardIsReachable(
  host: string,
  port: number,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`http://${host}:${port}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Headless TTY fallback. Renders the prompt with the SWT brand glyphs from
 * references/swt-brand-essentials.md (◆ awaiting, ✓ answered), reads the
 * user's selection, and follows up with a freeform textarea if "Other"
 * is picked.
 *
 * Returns `{ selectedOption: label, freeform: null }` when an option is
 * picked, or `{ selectedOption: null, freeform: text }` when "Other" is
 * picked AND the user enters freeform text.
 */
async function askViaTTY(
  q: AskUserQuestion,
  opts: AskUserOptions,
): Promise<AskUserResponse> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const lines: string[] = [];
    if (q.header) lines.push(`◆ ${q.header}`);
    lines.push(q.question, '');
    q.options.forEach((opt, idx) => {
      const tag = opt.isRecommended ? ' (recommended)' : '';
      lines.push(`  [${idx + 1}] ${opt.label}${tag}`);
    });
    const otherIndex = q.options.length + 1;
    lines.push(`  [${otherIndex}] Other (freeform)`, '');
    stdout.write(`${lines.join('\n')}\n`);

    const answer = (await rl.question('Select an option: ')).trim();
    const pick = Number.parseInt(answer, 10);
    if (Number.isNaN(pick) || pick < 1 || pick > otherIndex) {
      throw new Error(
        `askUser: invalid selection "${answer}". Expected an integer between 1 and ${otherIndex}.`,
      );
    }
    if (pick === otherIndex) {
      const freeform = (await rl.question('Other (enter your answer): ')).trim();
      // Empty freeform falls back to selectedOption: null + freeform: '' so
      // the caller can distinguish "user opted to give freeform but said
      // nothing" from "user picked an option". Treat empty freeform as a
      // valid response.
      return { selectedOption: null, freeform };
    }
    const picked = q.options[pick - 1]!;
    return { selectedOption: picked.label, freeform: null };
  } finally {
    rl.close();
  }
}

/**
 * Non-TTY headless auto-accept. Picks the recommended option (or first
 * option) and logs the choice to stderr so CI logs make the decision
 * auditable. Required for the askUser primitive to work in piped /
 * containerised / cron contexts where no human is present.
 */
function autoAcceptResponse(
  q: AskUserQuestion,
  opts: AskUserOptions,
): AskUserResponse {
  const stderr = opts.stderr ?? process.stderr;
  const picked = pickAutoAcceptOption(q);
  stderr.write(`[auto-accept: "${picked.label}"]\n`);
  return { selectedOption: picked.label, freeform: null };
}

/**
 * Primary path — publish the prompt to the dashboard and wait for the SSE
 * response event. The orchestrator polls /api/events for a prompt.response
 * with the matching prompt_id.
 *
 * Uses streaming fetch on the SSE endpoint to read line-by-line until the
 * matching response arrives. Aborts on timeout.
 */
async function askViaDashboard(
  q: AskUserQuestion,
  opts: AskUserOptions,
  host: string,
  port: number,
  sessionId: string,
  promptId: string,
  fetchImpl: typeof fetch,
): Promise<AskUserResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
  const promptRequest: PromptRequestEvent = {
    type: 'prompt.request',
    ts: new Date().toISOString(),
    session_id: sessionId,
    prompt_id: promptId,
    ...(q.header !== undefined ? { header: q.header } : {}),
    question: q.question,
    options: q.options.map((opt) => ({
      label: opt.label,
      ...(opt.isRecommended !== undefined ? { isRecommended: opt.isRecommended } : {}),
    })),
    ...(q.multiSelect !== undefined ? { multiSelect: q.multiSelect } : {}),
    ...(q.preview !== undefined ? { preview: q.preview } : {}),
  };

  const publishRes = await fetchImpl(`http://${host}:${port}/api/prompts/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(promptRequest),
  });
  if (!publishRes.ok) {
    throw new Error(
      `askUser: dashboard rejected publish (${publishRes.status}). ` +
        'The orchestrator should have already health-checked; this indicates a server-side bug.',
    );
  }

  // Open the SSE event stream filtered by session_id. The dashboard's
  // /api/events route honours the ?session_id= filter (events without a
  // session_id pass through; events tagged with another session are
  // dropped). 10-minute default timeout via AbortController.
  const sseAbort = new AbortController();
  const timer = setTimeout(() => sseAbort.abort(), timeoutMs);
  try {
    const sseRes = await fetchImpl(
      `http://${host}:${port}/api/events?session_id=${encodeURIComponent(sessionId)}`,
      {
        headers: { accept: 'text/event-stream' },
        signal: sseAbort.signal,
      },
    );
    if (!sseRes.ok || sseRes.body === null) {
      throw new Error(
        `askUser: SSE connection failed (${sseRes.status}). Falling back to headless not supported once publish has succeeded — re-issue the prompt.`,
      );
    }

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pendingEvent: string | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are delimited by a blank line; each frame has `event:`
      // and `data:` lines we care about. We split on \n and process line
      // by line so a partial chunk doesn't corrupt the parser state.
      let newlineIdx = buffer.indexOf('\n');
      while (newlineIdx !== -1) {
        const rawLine = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith('event:')) {
          pendingEvent = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:') && pendingEvent === 'prompt.response') {
          const payload = line.slice('data:'.length).trim();
          try {
            const parsed = JSON.parse(payload) as PromptResponseEvent;
            if (parsed.prompt_id === promptId) {
              // Found our response — release the reader and return.
              await reader.cancel().catch(() => {});
              return { selectedOption: parsed.selectedOption, freeform: parsed.freeform };
            }
          } catch {
            // Malformed JSON in the SSE stream is a server bug; skip and
            // keep reading. The timeout will fire if no valid response
            // arrives in time.
          }
        } else if (line === '') {
          // Empty line — end of an SSE frame. Reset the pending event so
          // the next frame's event: line is the new context.
          pendingEvent = null;
        }
        newlineIdx = buffer.indexOf('\n');
      }
    }
    throw new Error('askUser: SSE stream closed before a prompt.response arrived.');
  } catch (err) {
    if (sseAbort.signal.aborted) {
      throw new Error(
        `askUser: timed out after ${timeoutMs}ms waiting for prompt.response (prompt_id="${promptId}").`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the user a structured question. Resolves with their answer.
 *
 * Decision tree:
 *
 *   1. Validate the question shape (non-empty question + options).
 *   2. Health-check the dashboard (100ms budget).
 *      - 200 OK → publish + SSE-wait (primary path).
 *      - else → headless fallback:
 *          - TTY → readline prompt.
 *          - non-TTY → auto-accept the recommended/first option, log to
 *            stderr.
 *
 * Throws when the question shape is invalid or when the dashboard primary
 * path errors mid-flight (validation rejection, SSE stream closed without
 * a matching response, timeout). The headless fallback never throws unless
 * the TTY user enters a non-numeric selection.
 */
export async function askUser(
  q: AskUserQuestion,
  opts: AskUserOptions = {},
): Promise<AskUserResponse> {
  assertValidQuestion(q);

  const host = opts.dashboardHost ?? DEFAULT_DASHBOARD_HOST;
  const port = opts.dashboardPort ?? DEFAULT_DASHBOARD_PORT;
  const sessionId = opts.sessionId ?? randomUUID();
  const promptId = randomUUID();
  const fetchImpl = opts.fetch ?? fetch;

  const reachable = await dashboardIsReachable(host, port, fetchImpl);
  if (reachable) {
    return askViaDashboard(q, opts, host, port, sessionId, promptId, fetchImpl);
  }

  // Headless fallback. Tests can force this branch via `opts.fetch` returning
  // 503 on /api/health, then choose TTY vs auto-accept via `opts.isTTY`.
  const isTTY = opts.isTTY ?? Boolean((process.stdout as { isTTY?: boolean }).isTTY);
  if (isTTY) {
    return askViaTTY(q, opts);
  }
  return autoAcceptResponse(q, opts);
}
