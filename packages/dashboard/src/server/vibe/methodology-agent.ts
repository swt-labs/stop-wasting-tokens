import type { AgentPromptContext, AgentPromptOption } from '@swt-labs/dashboard-core';

import type { ApprovalDecision, ToolCall } from './permission-gate.js';

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
  /**
   * Called when the agent intercepts a tool call (file write, shell,
   * network). The dashboard wires `DashboardPermissionGate.requestApproval`
   * here so the gate's classification + user-decision surface mediates
   * every privileged operation. When omitted, agents bypass the gate
   * (terminal-side `swt vibe` already has its own gate; tests that don't
   * exercise tool calls don't need to wire this).
   */
  requestApproval?: (call: ToolCall) => Promise<ApprovalDecision>;
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
export type MethodologyAgentFactory = (input: {
  prompt: string;
  project_root: string;
}) => MethodologyAgent;

// ──────────────────────────────────────────────────────────────────────────
// ScriptedAgent — test-double
// ──────────────────────────────────────────────────────────────────────────

export type ScriptAction =
  | { type: 'stdout'; line: string }
  | { type: 'ask'; request: AskUserRequest }
  | {
      type: 'tool_call';
      call: ToolCall;
      /** Called with the gate's decision so test scripts can branch. */
      on_decision?: (decision: ApprovalDecision) => void;
      /** When true, fail with `tool_denied` if the gate denies. Default: continue. */
      fail_on_deny?: boolean;
    }
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
  /** Captured decisions from `requestApproval` so tests can inspect gate behavior. */
  readonly received_decisions: ApprovalDecision[] = [];

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
        case 'tool_call': {
          if (!opts.requestApproval) {
            return {
              success: false,
              error: 'tool_call action requires opts.requestApproval to be wired',
            };
          }
          const decision = await opts.requestApproval(action.call);
          this.received_decisions.push(decision);
          if (action.on_decision) action.on_decision(decision);
          if (action.fail_on_deny && !decision.allowed) {
            return { success: false, error: `tool_denied: ${decision.reason}` };
          }
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
