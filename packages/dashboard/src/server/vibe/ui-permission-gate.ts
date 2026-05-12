/**
 * UI-button permission gate per TDD2 §12.
 *
 * Sibling to `DashboardPermissionGate`. The two gates address different
 * permission surfaces:
 *
 *   - `DashboardPermissionGate` — daemon-spawned agent dispatches. Each
 *     dispatch carries a `session_id`; the gate surfaces an approval
 *     prompt to the user via the SSE channel and awaits a reply. The
 *     classification logic decides which operations auto-allow (reads
 *     inside $HOME, writes inside project root) vs require user
 *     confirmation (shell, network, MCP, out-of-project writes).
 *
 *   - `UiPermissionGate` (this file) — UI-button-originated POSTs (no
 *     `session_id`). These mutations come from authenticated localhost
 *     UI clicks (the user just pressed a button in the dashboard SPA).
 *     The trust model is: localhost-bind daemon + user-initiated click
 *     = pre-authorized. The gate auto-allows by default but emits an
 *     audit-trail entry through the event bus so operators have a
 *     record of every UI mutation.
 *
 * The classification surface is intentionally minimal — UI buttons are
 * already gated by the SPA's own confirmation dialogs for destructive
 * operations (e.g., "Regenerate phase: are you sure?"). The gate's job
 * is the audit trail and the routing seam, not a second confirmation
 * layer. M3 may extend `UiPermissionGate` with a server-side dangerous-
 * operation gate (e.g., reject `delete_phase` when the phase has unmerged
 * work); the surface stays the same.
 *
 * Why not extend `DashboardPermissionGate` to handle this case via a
 * `session_id?: string` field? Because the gates have distinct LIFETIMES
 * and STATE shapes. `DashboardPermissionGate` is per-session (one
 * instance per vibe session, lives for the session's duration). UI
 * mutations are SESSIONLESS — the same `UiPermissionGate` services every
 * UI button POST across the daemon's lifetime. Keeping them as siblings
 * avoids leaking session-coupled state into the sessionless path.
 */

import type { ToolCall } from './permission-gate.js';

export type UiApprovalDecision =
  | { allowed: true; via: 'ui-trust' }
  | { allowed: false; reason: 'classified_block'; user_note: string };

export interface UiApprovalContext {
  /** Endpoint that originated the UI mutation (e.g. `/api/config`). */
  readonly endpoint: string;
  /** Free-form actor label — typically `ui-button`; set for audit-log clarity. */
  readonly actor?: string;
}

export interface UiAuditEntry {
  readonly ts: string;
  readonly decision: 'allow' | 'block';
  readonly endpoint: string;
  readonly actor: string;
  readonly operation: ToolCall['operation'];
  readonly target: string;
  readonly reason?: string;
}

export interface UiAuditSink {
  /** Append an audit entry. Must not throw. */
  record(entry: UiAuditEntry): void;
}

export interface UiPermissionGateOptions {
  /**
   * Optional audit sink. M2 ships with a simple in-memory sink; M3
   * introduces a dedicated audit event type on the SSE channel so the
   * dashboard SPA can render an audit log. Decoupled as an interface so
   * the audit-trail wire-up is independent of the routing surface.
   */
  readonly auditSink?: UiAuditSink;
  /**
   * Optional server-side dangerous-operation gate. Returns the reason to
   * block when an operation is too dangerous to auto-allow at the UI tier.
   * M3+ may populate this for destructive operations (e.g., `delete_phase`
   * with unmerged work). M2 ships with an undefined default — every UI
   * mutation auto-allows.
   */
  readonly classify?: (call: ToolCall, context: UiApprovalContext) => string | undefined;
}

/**
 * Simple in-memory audit sink. Useful for tests and as the M2 default
 * surface; M3 swaps in an SSE-publishing sink without changing the gate
 * surface.
 */
export class InMemoryUiAuditSink implements UiAuditSink {
  readonly #entries: UiAuditEntry[] = [];

  record(entry: UiAuditEntry): void {
    this.#entries.push(entry);
  }

  entries(): ReadonlyArray<UiAuditEntry> {
    return [...this.#entries];
  }
}

/**
 * `UiPermissionGate` — handles UI-button-originated POSTs. Routes via the
 * `CompositePermissionGate` when no `session_id` is present in the request
 * context (the discriminant per TDD2 §12).
 */
export class UiPermissionGate {
  readonly #auditSink: UiAuditSink | undefined;
  readonly #classify: UiPermissionGateOptions['classify'];

  constructor(opts: UiPermissionGateOptions = {}) {
    this.#auditSink = opts.auditSink;
    this.#classify = opts.classify;
  }

  async requestApproval(call: ToolCall, context: UiApprovalContext): Promise<UiApprovalDecision> {
    const blockedReason = this.#classify?.(call, context);
    if (blockedReason !== undefined) {
      this.#recordAudit('block', call, context, blockedReason);
      return { allowed: false, reason: 'classified_block', user_note: blockedReason };
    }
    this.#recordAudit('allow', call, context);
    return { allowed: true, via: 'ui-trust' };
  }

  #recordAudit(
    decision: 'allow' | 'block',
    call: ToolCall,
    context: UiApprovalContext,
    reason?: string,
  ): void {
    if (this.#auditSink === undefined) return;
    this.#auditSink.record({
      ts: new Date().toISOString(),
      decision,
      endpoint: context.endpoint,
      actor: context.actor ?? 'ui-button',
      operation: call.operation,
      target: call.target,
      ...(reason !== undefined ? { reason } : {}),
    });
  }
}
