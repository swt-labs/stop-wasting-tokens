import { resolve } from 'node:path';

import { APPLY_PATCH_TOOL_NAME } from '@swt-labs/runtime';
import type { PiExtensionAPI, PiToolDefinition } from '@swt-labs/runtime';
import { describe, expect, it } from 'vitest';

import { resolveSpawnAgentConfig, type SpawnAgentOptions } from '../src/index.js';

/**
 * Phase 03 plan 03-01 T4 — provider-switching tool-shape regression.
 *
 * `apply_patch` (the Codex-shape file-edit primitive) is injected into the
 * resolved agent-session config ONLY when:
 *   - opts.provider === 'openai'  (strict equality; openrouter/openai/*
 *     intentionally excluded today — see the conservative-default note in
 *     spawn-agent.ts).
 *   - opts.role ∈ {lead, dev, qa, debugger, docs} (coding roles —
 *     read-only roles scout / architect MUST NOT get a write primitive).
 *
 * Each case introspects the resolved `extensions[]` entry by name and, for
 * positive cases, materializes the captured factory against a recording
 * PiExtensionAPI shim to confirm the registered tool name is exactly
 * `apply_patch`.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function baseOpts(
  role: SpawnAgentOptions['role'],
  overrides: Partial<SpawnAgentOptions> = {},
): SpawnAgentOptions {
  return {
    role,
    prompt: 'tool-shape probe',
    cwd: '/tmp/swt-tool-shape-test',
    sessionId: '00000000-0000-0000-0000-000000000000',
    installRoot: REPO_ROOT,
    ...overrides,
  };
}

function extensionNames(opts: SpawnAgentOptions): readonly string[] {
  return resolveSpawnAgentConfig(opts).extensions.map((e) => e.name);
}

function captureRegisteredToolName(factory: (pi: PiExtensionAPI) => void): string | undefined {
  const registered: PiToolDefinition[] = [];
  const pi: PiExtensionAPI = {
    registerTool<TParams = unknown>(def: PiToolDefinition<TParams>): void {
      registered.push(def as PiToolDefinition);
    },
    on() {
      // ignored for this introspection
    },
    appendEntry() {
      // ignored for this introspection
    },
  };
  factory(pi);
  return registered[0]?.name;
}

describe('spawn-agent — provider-gated apply_patch injection (Plan 03-01 T4)', () => {
  it("provider='openai' + role='dev' → extensions includes apply_patch and the factory registers a tool named 'apply_patch'", () => {
    const opts = baseOpts('dev', { provider: 'openai' });
    const names = extensionNames(opts);
    expect(names).toContain('applyPatch');

    const config = resolveSpawnAgentConfig(opts);
    const applyPatchExt = config.extensions.find((e) => e.name === 'applyPatch');
    expect(applyPatchExt).toBeDefined();
    if (applyPatchExt === undefined) return;
    const toolName = captureRegisteredToolName(applyPatchExt.factory);
    expect(toolName).toBe(APPLY_PATCH_TOOL_NAME);
    expect(toolName).toBe('apply_patch');
  });

  it("provider='anthropic' + role='dev' → no apply_patch extension", () => {
    const names = extensionNames(baseOpts('dev', { provider: 'anthropic' }));
    expect(names).not.toContain('applyPatch');
    expect(names).toContain('resultProtocol');
    expect(names).toContain('journal');
  });

  it("provider=undefined + role='dev' → no apply_patch extension", () => {
    const names = extensionNames(baseOpts('dev'));
    expect(names).not.toContain('applyPatch');
  });

  it("provider='openai' + role='scout' (read-only) → no apply_patch extension", () => {
    const names = extensionNames(baseOpts('scout', { provider: 'openai' }));
    expect(names).not.toContain('applyPatch');
    // scout still gets the baseline result-protocol + journal pair.
    expect(names).toContain('resultProtocol');
    expect(names).toContain('journal');
  });

  it("provider='openai' + role='architect' (read-only) → no apply_patch extension", () => {
    const names = extensionNames(baseOpts('architect', { provider: 'openai' }));
    expect(names).not.toContain('applyPatch');
  });

  it("provider='openrouter/openai/gpt-5' + role='dev' → no apply_patch extension (strict-equality boundary)", () => {
    const names = extensionNames(baseOpts('dev', { provider: 'openrouter/openai/gpt-5' }));
    expect(names).not.toContain('applyPatch');
  });

  it("provider='openai' + role='qa' (coding role) → apply_patch IS injected", () => {
    const names = extensionNames(baseOpts('qa', { provider: 'openai' }));
    expect(names).toContain('applyPatch');
  });

  it("provider='openai' + role='lead' (coding role) → apply_patch IS injected", () => {
    const names = extensionNames(baseOpts('lead', { provider: 'openai' }));
    expect(names).toContain('applyPatch');
  });
});
