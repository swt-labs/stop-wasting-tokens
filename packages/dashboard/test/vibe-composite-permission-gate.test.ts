/**
 * CompositePermissionGate tests (M2 PR-16).
 *
 * Exercises the routing decision:
 *   - With `session_id` → resolveSessionGate is consulted; the
 *     DashboardPermissionGate decision is returned.
 *   - Without `session_id` → UiPermissionGate is consulted.
 *   - Missing session gate when session_id is present → block.
 *
 * The DashboardPermissionGate is opaque to the composite — tests use a
 * stub that satisfies the surface (`requestApproval(call) →
 * Promise<ApprovalDecision>`).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.js';
import {
  CompositePermissionGate,
  type CompositePermissionContext,
} from '../src/server/vibe/composite-permission-gate.js';
import { DashboardPermissionGate, type ToolCall } from '../src/server/vibe/permission-gate.js';
import { createSessionRegistry, type SessionRegistry } from '../src/server/vibe/session.js';
import { InMemoryUiAuditSink, UiPermissionGate } from '../src/server/vibe/ui-permission-gate.js';

const PROJECT_ROOT = '/tmp/test-proj';
const READ_HOME_CALL: ToolCall = {
  operation: 'read_file',
  target: `${process.env.HOME ?? '/Users/test'}/.gitconfig`,
};
const SHELL_CALL: ToolCall = { operation: 'shell', target: 'pnpm test' };

let bus: EventBus;
let registry: SessionRegistry;
let planning_path: string;

beforeEach(() => {
  bus = createEventBus();
  planning_path = mkdtempSync(join(tmpdir(), 'swt-composite-gate-'));
  registry = createSessionRegistry({ bus, planning_path });
});

afterEach(() => {
  registry.shutdown();
  rmSync(planning_path, { recursive: true, force: true });
});

describe('CompositePermissionGate', () => {
  it('routes vibe-session POSTs (with session_id) to DashboardPermissionGate', async () => {
    registry.create({ project_root: PROJECT_ROOT, initial_prompt: 'p', id: 's1' });
    const sessionGate = new DashboardPermissionGate({
      registry,
      session_id: 's1',
      project_root: PROJECT_ROOT,
    });
    const uiGate = new UiPermissionGate();
    const composite = new CompositePermissionGate({
      resolveSessionGate: (id) => (id === 's1' ? sessionGate : undefined),
      uiGate,
    });
    // READ inside $HOME auto-allows via DashboardPermissionGate's classifier.
    const decision = await composite.requestApproval(READ_HOME_CALL, {
      endpoint: '/api/agent/prompt',
      session_id: 's1',
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.via).toBe('auto');
    }
  });

  it('routes UI-button POSTs (no session_id) to UiPermissionGate', async () => {
    const auditSink = new InMemoryUiAuditSink();
    const uiGate = new UiPermissionGate({ auditSink });
    const composite = new CompositePermissionGate({
      resolveSessionGate: () => undefined, // should never be called for UI POSTs
      uiGate,
    });
    const decision = await composite.requestApproval(SHELL_CALL, {
      endpoint: '/api/config',
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.via).toBe('ui-trust');
    }
    // Audit trail records the UI mutation.
    expect(auditSink.entries()).toHaveLength(1);
    expect(auditSink.entries()[0]?.endpoint).toBe('/api/config');
  });

  it('routes UI-button POSTs (empty session_id) to UiPermissionGate', async () => {
    const uiGate = new UiPermissionGate();
    const composite = new CompositePermissionGate({
      resolveSessionGate: () => undefined,
      uiGate,
    });
    const decision = await composite.requestApproval(SHELL_CALL, {
      endpoint: '/api/command',
      session_id: '',
    });
    expect(decision.allowed).toBe(true);
  });

  it('blocks when session_id is set but no session gate is registered', async () => {
    const uiGate = new UiPermissionGate();
    const composite = new CompositePermissionGate({
      resolveSessionGate: () => undefined,
      uiGate,
    });
    const decision = await composite.requestApproval(SHELL_CALL, {
      endpoint: '/api/agent/prompt',
      session_id: 'orphan-session-id',
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('classified_block');
      expect(decision.user_note).toContain('orphan-session-id');
    }
  });

  it('preserves DashboardPermissionGate denial reasons', async () => {
    // Pre-populate session, then mock the gate to deny.
    registry.create({ project_root: PROJECT_ROOT, initial_prompt: 'p', id: 's2' });
    const denyingGate = {
      async requestApproval() {
        return {
          allowed: false as const,
          reason: 'user_denied' as const,
          user_note: 'user clicked deny',
        };
      },
    } as unknown as DashboardPermissionGate;
    const composite = new CompositePermissionGate({
      resolveSessionGate: () => denyingGate,
      uiGate: new UiPermissionGate(),
    });
    const decision = await composite.requestApproval(SHELL_CALL, {
      endpoint: '/api/agent/prompt',
      session_id: 's2',
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('user_denied');
      expect(decision.user_note).toBe('user clicked deny');
    }
  });

  it('does NOT route to UiPermissionGate when session_id IS present (no fallback)', async () => {
    let uiInvocations = 0;
    const uiGate = {
      async requestApproval() {
        uiInvocations += 1;
        return { allowed: true as const, via: 'ui-trust' as const };
      },
    } as unknown as UiPermissionGate;
    const composite = new CompositePermissionGate({
      resolveSessionGate: () => undefined, // session gate missing
      uiGate,
    });
    await composite.requestApproval(SHELL_CALL, {
      endpoint: '/api/agent/prompt',
      session_id: 'some-id',
    });
    // The composite blocks instead of falling back to UI gate when
    // session_id is present but its gate is missing.
    expect(uiInvocations).toBe(0);
  });
});

const _typeCheckOnlyCtx: CompositePermissionContext = { endpoint: '/x' };
void _typeCheckOnlyCtx;
