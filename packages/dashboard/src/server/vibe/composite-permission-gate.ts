/**
 * Composite permission gate per TDD2 §12.
 *
 * Routes permission requests to one of two sibling gates based on the
 * request's *origin shape*:
 *
 *   - **vibe-session POST** — carries a `session_id`. Routes to
 *     `DashboardPermissionGate` (the per-session SSE-prompt-driven gate).
 *     This is the path daemon-spawned agents take during a vibe run.
 *
 *   - **UI-button POST** — no `session_id`. Routes to `UiPermissionGate`
 *     (the sessionless audit-trail gate). This is the path user-initiated
 *     dashboard buttons take.
 *
 * The composite gate exists so route handlers don't have to know which
 * sub-gate to consult — they call `composite.requestApproval(call,
 * context)` and the composite picks. Adoption is incremental: existing
 * routes (`/api/config`, `/api/init`, etc.) can keep their current
 * auto-allow trust-model behavior; new routes (or migrated existing
 * ones) wire the composite to gain the audit trail + future
 * dangerous-operation hook for free.
 *
 * Decision surface — the composite returns a uniform `CompositeDecision`
 * shape so callers can branch on `allowed` without unwrapping the
 * sub-gate's specific decision type. The two sub-gates' reason codes
 * are preserved on the `via` and `reason` fields for audit logging.
 */

import type { DashboardPermissionGate, ToolCall } from './permission-gate.js';
import type { UiApprovalContext, UiPermissionGate } from './ui-permission-gate.js';

export type CompositeDecision =
  | { allowed: true; via: 'auto' | 'allowlist' | 'user' | 'ui-trust' }
  | {
      allowed: false;
      reason: 'user_denied' | 'user_no_reply' | 'classified_block';
      user_note?: string;
    };

export interface CompositePermissionContext {
  /** Endpoint that originated the request — surfaced to audit logs. */
  readonly endpoint: string;
  /** Session id when the request comes from an active vibe session; absent for UI-button POSTs. */
  readonly session_id?: string;
}

export interface CompositePermissionGateOptions {
  /**
   * Resolve the per-session `DashboardPermissionGate` for a given
   * `session_id`. Returns `undefined` when no live gate exists for that
   * session (the composite then falls back to deny with `classified_block`).
   * Decoupled as a function so the composite doesn't have to wire the full
   * session registry; the daemon supplies a lookup that knows.
   */
  readonly resolveSessionGate: (sessionId: string) => DashboardPermissionGate | undefined;
  /** The single, sessionless UI gate. */
  readonly uiGate: UiPermissionGate;
}

export class CompositePermissionGate {
  readonly #resolveSessionGate: CompositePermissionGateOptions['resolveSessionGate'];
  readonly #uiGate: UiPermissionGate;

  constructor(opts: CompositePermissionGateOptions) {
    this.#resolveSessionGate = opts.resolveSessionGate;
    this.#uiGate = opts.uiGate;
  }

  async requestApproval(
    call: ToolCall,
    context: CompositePermissionContext,
  ): Promise<CompositeDecision> {
    if (context.session_id !== undefined && context.session_id.length > 0) {
      const sessionGate = this.#resolveSessionGate(context.session_id);
      if (sessionGate === undefined) {
        return {
          allowed: false,
          reason: 'classified_block',
          user_note: `no live DashboardPermissionGate for session_id=${context.session_id}`,
        };
      }
      const decision = await sessionGate.requestApproval(call);
      if (decision.allowed) {
        return { allowed: true, via: decision.via };
      }
      return {
        allowed: false,
        reason: decision.reason,
        ...(decision.user_note !== undefined ? { user_note: decision.user_note } : {}),
      };
    }
    const uiContext: UiApprovalContext = { endpoint: context.endpoint };
    const decision = await this.#uiGate.requestApproval(call, uiContext);
    if (decision.allowed) {
      return { allowed: true, via: decision.via };
    }
    return {
      allowed: false,
      reason: decision.reason,
      user_note: decision.user_note,
    };
  }
}
