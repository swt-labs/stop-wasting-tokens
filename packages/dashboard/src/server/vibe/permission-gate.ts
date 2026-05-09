import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

import type { AgentPromptContext } from '@swt-labs/dashboard-core';

import type { ReplyKind, SessionRegistry } from './session.js';

/**
 * The set of operations a daemon-spawned agent can request approval for.
 * Mirrors the `operation` enum in `agent.prompt` event schema.
 */
export type ToolOperation =
  | 'read_file'
  | 'write_file'
  | 'shell'
  | 'network'
  | 'mcp_action'
  | 'process_spawn';

export interface ToolCall {
  operation: ToolOperation;
  /**
   * Target of the operation:
   *   - file_read / file_write → absolute or relative path
   *   - shell / process_spawn → command string
   *   - network → URL
   *   - mcp_action → "${server_name}/${tool_name}"
   */
  target: string;
  /**
   * MCP-specific metadata. Present only for `mcp_action`.
   */
  mcp?: {
    server_name: string;
    /** Whether the server is marked `trusted: true` in `~/.swt/mcp.json`. */
    server_trusted: boolean;
  };
}

export type ApprovalDecision =
  | { allowed: true; via: 'auto' | 'allowlist' | 'user' }
  | {
      allowed: false;
      reason: 'user_denied' | 'user_no_reply' | 'classified_block';
      user_note?: string;
    };

export type Classification =
  | { kind: 'auto-allow'; rationale: string }
  | { kind: 'requires-confirm'; risk_summary: string };

export interface DashboardPermissionGateOptions {
  registry: SessionRegistry;
  /** Active vibe session id; the gate emits prompts via this session's channel. */
  session_id: string;
  /** Project root resolved at session start; in-project writes auto-allow. */
  project_root: string;
}

/**
 * Implements `v2-permission-model.md` for daemon-spawned agents.
 *
 * Composition with `core/abstractions/PermissionGate.ts`:
 *   - The core PermissionGate handles static profile evaluation (sandbox
 *     modes, named profiles, terminal-side stdin prompts).
 *   - This DashboardPermissionGate handles dynamic per-call user approval
 *     routed through the agent.prompt SSE channel.
 *   - Both can coexist — daemon-spawned agents hit DashboardPermissionGate
 *     for the user-decision surface; the underlying Codex sandbox provides
 *     defense-in-depth via the core gate.
 */
export class DashboardPermissionGate {
  readonly #registry: SessionRegistry;
  readonly #sessionId: string;
  readonly #projectRoot: string;
  readonly #homeDir: string;

  constructor(opts: DashboardPermissionGateOptions) {
    this.#registry = opts.registry;
    this.#sessionId = opts.session_id;
    this.#projectRoot = resolve(opts.project_root);
    this.#homeDir = homedir();
  }

  classify(call: ToolCall): Classification {
    switch (call.operation) {
      case 'read_file':
        return this.#classifyRead(call.target);
      case 'write_file':
        return this.#classifyWrite(call.target);
      case 'shell':
        return {
          kind: 'requires-confirm',
          risk_summary:
            'Shell commands can run arbitrary code, install packages, or modify files anywhere. Confirm before approving.',
        };
      case 'network':
        return {
          kind: 'requires-confirm',
          risk_summary:
            'Outbound HTTP can send data from your project to a third party or fetch arbitrary code. Confirm the target URL is what you expect.',
        };
      case 'mcp_action':
        return this.#classifyMcp(call);
      case 'process_spawn':
        return {
          kind: 'requires-confirm',
          risk_summary:
            'Process spawn has the same risk profile as shell. Confirm the command and arguments are safe.',
        };
    }
  }

  async requestApproval(call: ToolCall): Promise<ApprovalDecision> {
    const classification = this.classify(call);
    if (classification.kind === 'auto-allow') {
      return { allowed: true, via: 'auto' };
    }

    // Check the in-memory session allowlist (populated by previous "Approve
    // for session" replies). Allowlist is keyed by ${operation}::${target}
    // exact match — a future plan can broaden to target patterns.
    const session = this.#registry.get(this.#sessionId);
    if (session) {
      const key = `${call.operation}::${call.target}`;
      if (session.permission_allowlist.has(key)) {
        return { allowed: true, via: 'allowlist' };
      }
    }

    const context: AgentPromptContext = {
      operation: this.#protocolOperation(call.operation),
      target: call.target,
      risk_summary: classification.risk_summary,
    };

    const emitted = this.#registry.emitPrompt(this.#sessionId, {
      subtype: 'permission',
      question: this.#humanQuestion(call),
      context,
    });
    if (!emitted) {
      // FIFO conflict — another prompt is pending. Treat as deny so the
      // agent can retry once the active prompt resolves.
      return {
        allowed: false,
        reason: 'classified_block',
        user_note: 'another prompt is currently pending in this session',
      };
    }

    const reply = await this.#registry.awaitReply(this.#sessionId);
    return this.#mapReply(reply);
  }

  // ────────────────────────────────────────────────────────────────────────
  // private classification helpers
  // ────────────────────────────────────────────────────────────────────────

  #classifyRead(target: string): Classification {
    if (this.#isUnderHome(target)) {
      return { kind: 'auto-allow', rationale: 'read inside $HOME' };
    }
    return {
      kind: 'requires-confirm',
      risk_summary: `File is outside your home directory (${this.#homeDir}). Read-only operation; confirm the path is what you expect.`,
    };
  }

  #classifyWrite(target: string): Classification {
    if (this.#isUnderProjectRoot(target)) {
      return { kind: 'auto-allow', rationale: 'write inside project root' };
    }
    return {
      kind: 'requires-confirm',
      risk_summary: `File is outside the project root (${this.#projectRoot}). Modifying it affects state beyond this project.`,
    };
  }

  #classifyMcp(call: ToolCall): Classification {
    if (call.mcp?.server_trusted === true) {
      return {
        kind: 'auto-allow',
        rationale: `MCP server "${call.mcp.server_name}" is in the trusted allowlist`,
      };
    }
    return {
      kind: 'requires-confirm',
      risk_summary: `MCP tool "${call.target}" runs against a non-trusted server. Side effects depend on the server.`,
    };
  }

  #isUnderProjectRoot(target: string): boolean {
    if (!isAbsolute(target)) return true; // relative paths resolve under cwd; treat as in-project
    const rel = relative(this.#projectRoot, resolve(target));
    return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
  }

  #isUnderHome(target: string): boolean {
    if (!isAbsolute(target)) return true; // relative paths in the project are under HOME
    const rel = relative(this.#homeDir, resolve(target));
    return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
  }

  #protocolOperation(op: ToolOperation): NonNullable<AgentPromptContext['operation']> {
    if (op === 'process_spawn') return 'shell'; // protocol enum does not have process_spawn; collapse
    return op;
  }

  #humanQuestion(call: ToolCall): string {
    switch (call.operation) {
      case 'read_file':
        return `Allow reading the file at ${call.target}?`;
      case 'write_file':
        return `Allow writing to ${call.target}?`;
      case 'shell':
        return `Allow running shell command: ${call.target}?`;
      case 'network':
        return `Allow HTTP request to ${call.target}?`;
      case 'mcp_action':
        return `Allow MCP action ${call.target}?`;
      case 'process_spawn':
        return `Allow process spawn: ${call.target}?`;
    }
  }

  #mapReply(reply: ReplyKind): ApprovalDecision {
    if (reply.kind === 'expired') {
      return { allowed: false, reason: 'user_no_reply' };
    }
    if (reply.kind !== 'permission') {
      // Defensive: the prompt was permission-subtype, so the registry
      // should reject mismatched reply kinds upstream. If somehow we get
      // here with a non-permission reply, treat as deny.
      return {
        allowed: false,
        reason: 'user_denied',
        user_note: `unexpected reply kind: ${reply.kind}`,
      };
    }
    if (reply.decision === 'deny') {
      return {
        allowed: false,
        reason: 'user_denied',
        ...(reply.user_note !== undefined ? { user_note: reply.user_note } : {}),
      };
    }
    return { allowed: true, via: 'user' };
  }
}
