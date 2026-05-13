import { describe, expect, it } from 'vitest';

import { AGENT_ROLES, isAgentRole, type AgentRole } from '../../src/types/agent-role.js';

/**
 * Plan 01-01 T02 — AgentRole union must include `'docs'` so Phase 3 can
 * spawn the documentation agent without a TypeScript widening hack.
 *
 * Plan 01-05 (Task A.6) will add the mechanical exclusion test that
 * asserts `swt:askUser` is never registered in any non-orchestrator role's
 * tool list; this test guards the count contract that A.6 depends on
 * (it iterates AGENT_ROLES).
 */
describe('@swt-labs/shared — AgentRole', () => {
  it('AGENT_ROLES has 8 entries (orchestrator + 7 SDLC roles incl. docs)', () => {
    expect(AGENT_ROLES.length).toBe(8);
  });

  it('AGENT_ROLES contains every expected role exactly once', () => {
    const expected: ReadonlyArray<AgentRole> = [
      'orchestrator',
      'scout',
      'architect',
      'lead',
      'dev',
      'qa',
      'debugger',
      'docs',
    ];
    expect([...AGENT_ROLES].sort()).toEqual([...expected].sort());
    // Each entry appears exactly once — guards against accidental duplication
    // (e.g., a future contributor appending 'docs' to both the union and the
    // array but forgetting to deduplicate).
    const counts = new Map<string, number>();
    for (const role of AGENT_ROLES) counts.set(role, (counts.get(role) ?? 0) + 1);
    for (const [role, n] of counts) {
      expect(n, `role ${role} should appear exactly once`).toBe(1);
    }
  });

  it("isAgentRole('docs') returns true (regression guard for Plan 01-01 T02)", () => {
    expect(isAgentRole('docs')).toBe(true);
  });

  it('isAgentRole returns true for every canonical role', () => {
    for (const role of AGENT_ROLES) {
      expect(isAgentRole(role), `${role} should be a valid AgentRole`).toBe(true);
    }
  });

  it('isAgentRole rejects unknown strings + non-string inputs', () => {
    expect(isAgentRole('unknown')).toBe(false);
    expect(isAgentRole('')).toBe(false);
    expect(isAgentRole(null)).toBe(false);
    expect(isAgentRole(undefined)).toBe(false);
    expect(isAgentRole(42)).toBe(false);
    expect(isAgentRole({})).toBe(false);
  });
});
