/**
 * F-17 — Agent prompt cache-hit measurement.
 *
 * REQ-05 promises cache-aware split prompts: a stable static prefix layer
 * (`developer_instructions` + role config) plus a dynamic per-call layer.
 * The Codex prompt cache keys off the static prefix, so SWT must guarantee
 * that two invocations of the same role with the same spec produce a
 * byte-identical TOML profile. This test asserts that contract directly so
 * regressions surface as deterministic test failures rather than a degraded
 * cache hit-rate in production.
 */
import { createHash } from 'node:crypto';

import type { AgentSpec } from '@swt-labs/core';
import { describe, expect, it } from 'vitest';

import { emitAgentToml } from '../src/toml/agents.js';

const STABLE_SPEC: AgentSpec = {
  role: 'lead',
  model: 'gpt-5.3-codex',
  reasoning_effort: 'medium',
  developer_instructions: 'Plan thoroughly. Use must_haves.',
  allowed_mcp_servers: ['filesystem', 'git'],
  sandbox_mode: 'workspace-write',
  max_turns: 50,
};

function digest(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

describe('Agent prompt cache-hit (F-17 / REQ-05)', () => {
  it('produces byte-identical TOML for the same spec across repeated calls', () => {
    const first = emitAgentToml(STABLE_SPEC);
    const second = emitAgentToml(STABLE_SPEC);
    expect(second).toBe(first);
    expect(digest(second)).toBe(digest(first));
  });

  it('produces a different prefix when the static layer changes', () => {
    const baseHash = digest(emitAgentToml(STABLE_SPEC));
    const tweaked: AgentSpec = {
      ...STABLE_SPEC,
      developer_instructions: STABLE_SPEC.developer_instructions + ' (revised)',
    };
    expect(digest(emitAgentToml(tweaked))).not.toBe(baseHash);
  });

  it('treats key insertion order as stable (object identity does not affect emit)', () => {
    // Construct the spec via spread + reassembly to verify the emitter sorts /
    // serializes deterministically — Node object property iteration is stable
    // by spec, but TOML emitters that walk keys themselves can drift.
    const reordered: AgentSpec = {
      max_turns: STABLE_SPEC.max_turns,
      sandbox_mode: STABLE_SPEC.sandbox_mode,
      allowed_mcp_servers: STABLE_SPEC.allowed_mcp_servers,
      developer_instructions: STABLE_SPEC.developer_instructions,
      reasoning_effort: STABLE_SPEC.reasoning_effort,
      model: STABLE_SPEC.model,
      role: STABLE_SPEC.role,
    };
    expect(digest(emitAgentToml(reordered))).toBe(digest(emitAgentToml(STABLE_SPEC)));
  });
});
