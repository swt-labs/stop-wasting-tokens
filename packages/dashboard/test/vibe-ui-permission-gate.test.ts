/**
 * UiPermissionGate tests (M2 PR-16).
 *
 * Exercises:
 *   - Default auto-allow path (no classifier) — every UI mutation passes.
 *   - Classifier-block path — a server-side dangerous-op gate can reject.
 *   - Audit-sink emission on both decision types.
 *   - Sessionless lifetime — one gate instance services every UI POST.
 */

import { describe, expect, it } from 'vitest';

import type { ToolCall } from '../src/server/vibe/permission-gate.js';
import {
  InMemoryUiAuditSink,
  UiPermissionGate,
  type UiApprovalContext,
} from '../src/server/vibe/ui-permission-gate.js';

const SHELL_CALL: ToolCall = { operation: 'shell', target: 'pnpm test' };
const WRITE_CALL: ToolCall = { operation: 'write_file', target: '/tmp/test/foo.ts' };
const NETWORK_CALL: ToolCall = { operation: 'network', target: 'https://api.example.com' };

const UI_CONTEXT: UiApprovalContext = { endpoint: '/api/config', actor: 'ui-button' };

describe('UiPermissionGate', () => {
  it('auto-allows every UI POST when no classifier is provided', async () => {
    const gate = new UiPermissionGate();
    for (const call of [SHELL_CALL, WRITE_CALL, NETWORK_CALL]) {
      const decision = await gate.requestApproval(call, UI_CONTEXT);
      expect(decision.allowed, `${call.operation} should auto-allow`).toBe(true);
      if (decision.allowed) {
        expect(decision.via).toBe('ui-trust');
      }
    }
  });

  it('blocks when the classifier returns a reason string', async () => {
    const gate = new UiPermissionGate({
      classify: (call) =>
        call.operation === 'write_file' && call.target.startsWith('/etc/')
          ? 'writes to /etc are never allowed from the UI'
          : undefined,
    });
    const blocked = await gate.requestApproval(
      { operation: 'write_file', target: '/etc/passwd' },
      UI_CONTEXT,
    );
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe('classified_block');
      expect(blocked.user_note).toContain('/etc');
    }

    // A non-matching call still allows.
    const allowed = await gate.requestApproval(WRITE_CALL, UI_CONTEXT);
    expect(allowed.allowed).toBe(true);
  });

  it('records audit entries for both allow and block decisions when a sink is provided', async () => {
    const sink = new InMemoryUiAuditSink();
    const gate = new UiPermissionGate({
      auditSink: sink,
      classify: (call) =>
        call.operation === 'network' ? 'no UI-initiated network calls' : undefined,
    });
    await gate.requestApproval(WRITE_CALL, UI_CONTEXT);
    await gate.requestApproval(NETWORK_CALL, UI_CONTEXT);

    const entries = sink.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.decision).toBe('allow');
    expect(entries[0]?.operation).toBe('write_file');
    expect(entries[0]?.endpoint).toBe('/api/config');
    expect(entries[1]?.decision).toBe('block');
    expect(entries[1]?.operation).toBe('network');
    expect(entries[1]?.reason).toContain('network');
  });

  it('defaults the actor to "ui-button" when not specified', async () => {
    const sink = new InMemoryUiAuditSink();
    const gate = new UiPermissionGate({ auditSink: sink });
    await gate.requestApproval(WRITE_CALL, { endpoint: '/api/init' });
    expect(sink.entries()[0]?.actor).toBe('ui-button');
  });

  it('does NOT record audit entries when no sink is provided', async () => {
    const gate = new UiPermissionGate();
    // Just verify it doesn't throw.
    const decision = await gate.requestApproval(WRITE_CALL, UI_CONTEXT);
    expect(decision.allowed).toBe(true);
  });

  it('one gate instance services many UI POSTs across the daemon lifetime', async () => {
    // Sessionless: unlike DashboardPermissionGate, no per-session state.
    const gate = new UiPermissionGate();
    const calls: ToolCall[] = [
      { operation: 'read_file', target: '/tmp/a' },
      { operation: 'write_file', target: '/tmp/b' },
      { operation: 'shell', target: 'echo hi' },
      { operation: 'process_spawn', target: 'node' },
    ];
    for (const call of calls) {
      const decision = await gate.requestApproval(call, UI_CONTEXT);
      expect(decision.allowed).toBe(true);
    }
  });
});
