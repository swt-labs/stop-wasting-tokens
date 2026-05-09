import type { AgentPromptContext, AgentPromptOption } from '@swt-labs/dashboard-core';

/**
 * The dashboard's agent-runner abstraction. Decouples `runMethodologyLoop()`
 * from any specific agent backend. v2.0 ships:
 *
 * - `ScriptedAgent` (this file) — test double that runs a static script of
 *   `ask` / `complete` / `fail` actions against the loop's `askUser`
 *   callback. Used in unit + e2e tests so we can verify the loop contract
 *   without spawning real Codex.
 *
 * - `CodexMethodologyAgent` (separate plan, follow-up to 02-03) — wraps
 *   `child_process.spawn('codex', ...)` and streams stdin/stdout through
 *   the marker parser/injector in `./markers.ts`. Production runner.
 */

export interface AskUserRequest {
  question: string;
  subtype: 'clarification' | 'permission';
  options?: AgentPromptOption[];
  context?: AgentPromptContext;
}

export type AskUserReply =
  | { kind: 'free_form'; text: string }
  | { kind: 'choice'; value: string }
  | { kind: 'permission'; decision: 'once' | 'session' | 'deny'; user_note?: string }
  | { kind: 'expired' };

export interface MethodologyAgentRunOpts {
  prompt: string;
  /** Called with each line of agent stdout (markers stripped). */
  onStdoutLine: (line: string) => void;
  /**
   * Called when the agent emits an ASK_USER marker. Resolves with the
   * user's reply (or `{kind: 'expired'}` on timeout). The caller blocks
   * the agent until this resolves — guaranteeing the agent's stdin won't
   * receive USER_REPLY before the user actually replies.
   */
  askUser: (request: AskUserRequest) => Promise<AskUserReply>;
  /** Optional abort signal. */
  abortSignal?: AbortSignal;
}

export interface MethodologyAgentResult {
  success: boolean;
  text?: string;
  error?: string;
}

export interface MethodologyAgent {
  run(opts: MethodologyAgentRunOpts): Promise<MethodologyAgentResult>;
}

/**
 * A factory function for creating an agent. Lets the dashboard daemon's
 * `/api/vibe` route swap implementations between test (`ScriptedAgent`)
 * and production (`CodexMethodologyAgent`) without import cycles.
 */
export type MethodologyAgentFactory = (input: { prompt: string; project_root: string }) =>
  MethodologyAgent;

// ──────────────────────────────────────────────────────────────────────────
// ScriptedAgent — test-double
// ──────────────────────────────────────────────────────────────────────────

export type ScriptAction =
  | { type: 'stdout'; line: string }
  | { type: 'ask'; request: AskUserRequest }
  | { type: 'complete'; text?: string }
  | { type: 'fail'; error: string };

export interface ScriptedAgentOptions {
  script: ScriptAction[];
  /** Optional per-step delay (ms) for testing async timing. Default 0. */
  step_delay_ms?: number;
}

export class ScriptedAgent implements MethodologyAgent {
  readonly #script: ScriptAction[];
  readonly #stepDelayMs: number;
  /** Captured replies from `askUser` so tests can inspect what the user said. */
  readonly received_replies: AskUserReply[] = [];

  constructor(opts: ScriptedAgentOptions) {
    this.#script = opts.script;
    this.#stepDelayMs = opts.step_delay_ms ?? 0;
  }

  async run(opts: MethodologyAgentRunOpts): Promise<MethodologyAgentResult> {
    for (const action of this.#script) {
      if (opts.abortSignal?.aborted) {
        return { success: false, error: 'aborted' };
      }
      if (this.#stepDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.#stepDelayMs));
      }
      switch (action.type) {
        case 'stdout':
          opts.onStdoutLine(action.line);
          break;
        case 'ask': {
          const reply = await opts.askUser(action.request);
          this.received_replies.push(reply);
          break;
        }
        case 'complete':
          return action.text !== undefined
            ? { success: true, text: action.text }
            : { success: true };
        case 'fail':
          return { success: false, error: action.error };
      }
    }
    // Script exhausted without explicit complete/fail — treat as success.
    return { success: true };
  }
}
