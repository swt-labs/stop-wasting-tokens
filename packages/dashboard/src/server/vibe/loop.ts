import type { AgentPromptContext, AgentPromptOption, SnapshotEvent } from '@swt-labs/shared';

import type { EventBus } from '../event-bus.js';

import type {
  AskUserReply,
  MethodologyAgent,
  MethodologyAgentResult,
  MethodologyAgentRunOpts,
} from './methodology-agent.js';
import type { DashboardPermissionGate } from './permission-gate.js';
import type { SessionRegistry } from './session.js';

export interface RunMethodologyLoopOptions {
  agent: MethodologyAgent;
  registry: SessionRegistry;
  bus: EventBus;
  session_id: string;
  prompt: string;
  /**
   * Optional permission gate. When provided, the loop wires
   * `gate.requestApproval` as the agent's `requestApproval` callback so
   * every tool call routes through the gate (auto-allow / allowlist /
   * user-decision via the chat channel). When omitted, agents that try
   * to invoke `opts.requestApproval` will receive `undefined` and must
   * handle the absence (ScriptedAgent fails the run; CodexMethodologyAgent
   * may default-deny depending on Plan 02-04's wiring).
   */
  gate?: DashboardPermissionGate;
  abortSignal?: AbortSignal;
}

/**
 * Drive a methodology agent through one full session lifecycle, surfacing
 * its `askUser` requests via `registry.emitPrompt()` + `registry.awaitReply()`
 * and forwarding its stdout lines to the SSE bus as `log.append` events.
 *
 * The agent's `askUser` callback blocks until the user replies (or the
 * prompt expires). This keeps the agent quiescent without any explicit
 * pause/resume — the existing JavaScript event loop handles the wait.
 *
 * Session state transitions:
 *   idle → running (on entry)
 *   running → awaiting-reply (set by registry.emitPrompt)
 *   awaiting-reply → running (set by registry.reply)
 *   running → completed | failed (on exit)
 *
 * Errors thrown by the agent become `{success: false, error}` results;
 * the session moves to `failed` and an `error` SSE event is published.
 */
export async function runMethodologyLoop(
  opts: RunMethodologyLoopOptions,
): Promise<MethodologyAgentResult> {
  const { agent, registry, bus, session_id, prompt, gate, abortSignal } = opts;

  registry.setState(session_id, 'running');

  const onStdoutLine = (line: string): void => {
    if (line.length === 0) return;
    const evt: SnapshotEvent = {
      type: 'log.append',
      ts: new Date().toISOString(),
      channel: 'stdout',
      line,
    };
    bus.publish(evt);
  };

  const askUser = async (request: {
    question: string;
    subtype: 'clarification' | 'permission';
    options?: AgentPromptOption[];
    context?: AgentPromptContext;
  }): Promise<AskUserReply> => {
    const emitted = registry.emitPrompt(session_id, {
      subtype: request.subtype,
      question: request.question,
      ...(request.options !== undefined ? { options: request.options } : {}),
      ...(request.context !== undefined ? { context: request.context } : {}),
    });
    if (!emitted) {
      throw new Error(
        `runMethodologyLoop: registry.emitPrompt returned null for session ${session_id} ` +
          `(probable FIFO conflict — another prompt is already pending)`,
      );
    }
    return registry.awaitReply(session_id);
  };

  try {
    const runOpts: MethodologyAgentRunOpts = {
      prompt,
      onStdoutLine,
      askUser,
      ...(gate !== undefined ? { requestApproval: (call) => gate.requestApproval(call) } : {}),
      ...(abortSignal !== undefined ? { abortSignal } : {}),
    };
    const result = await agent.run(runOpts);
    registry.setState(session_id, result.success ? 'completed' : 'failed');
    if (!result.success && result.error) {
      bus.publish({
        type: 'error',
        ts: new Date().toISOString(),
        code: 'agent_failed',
        message: result.error,
      });
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    registry.setState(session_id, 'failed');
    bus.publish({
      type: 'error',
      ts: new Date().toISOString(),
      code: 'loop_failed',
      message,
    });
    return { success: false, error: message };
  }
}
