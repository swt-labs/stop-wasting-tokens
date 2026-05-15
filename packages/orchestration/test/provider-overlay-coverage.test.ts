/**
 * Phase 01 / Plan 01-01 T2 — OpenAI overlay coverage regression test.
 *
 * Asserts that EVERY SDLC role (lead, scout, architect, dev, qa, debugger,
 * docs) has an openai overlay file at `provider_overlays/<role>-openai.md`
 * that:
 *   - loads end-to-end via `readProviderOverlay(repoRoot, role, 'openai')`
 *     returning a non-empty body with YAML frontmatter stripped;
 *   - contains the canonical intent-mirror header comment;
 *   - uses SWT-native tool vocabulary (Edit / Bash / Read / Grep / LSP) in
 *     the body (no Codex CLI vocabulary leaks);
 *   - has the required frontmatter fields on disk.
 *
 * Single responsibility: this file gates COVERAGE (all 7 roles present);
 * the sibling `provider-overlay.test.ts` gates loader SEMANTICS (resolution
 * order, frontmatter-stripping edge cases, ENOENT safety). A missing role
 * surfaces here as a per-role test failure naming the missing file path —
 * NOT as one opaque coverage assertion.
 *
 * `orchestrator` is intentionally NOT in `ALL_SDLC_ROLES` — per the
 * spawn-agent.ts:359-362 invariant, the orchestrator is the caller, not a
 * spawnable agent, and has no role-prompt overlay.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { readProviderOverlay } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
// Test file lives at packages/orchestration/test/; repo root is 3 levels up.
const repoRoot = resolve(dirname(__filename), '..', '..', '..');

const ALL_SDLC_ROLES = ['lead', 'scout', 'architect', 'dev', 'qa', 'debugger', 'docs'] as const;

describe('Phase 01 — OpenAI overlay coverage (all 7 SDLC roles)', () => {
  test.each(ALL_SDLC_ROLES)('%s has an openai overlay that loads end-to-end', (role) => {
    const body = readProviderOverlay(repoRoot, role, 'openai');
    expect(body, `missing overlay: provider_overlays/${role}-openai.md`).toBeDefined();
    expect(body).not.toBe('');
    // Frontmatter must be stripped — body should NOT start with `---`.
    expect(body!.startsWith('---')).toBe(false);
    // Canonical intent-mirror header comment.
    expect(body).toMatch(/Intent-mirror of OpenAI Codex CLI/);
    expect(body).toMatch(/DO NOT copy verbatim/);
    // Body references SWT-native tools (sanity check the authoring discipline).
    expect(body).toMatch(/Edit|Bash|Read|Grep|LSP/);
  });

  test.each(ALL_SDLC_ROLES)('%s overlay has valid frontmatter on disk', (role) => {
    const filePath = resolve(repoRoot, 'provider_overlays', `${role}-openai.md`);
    const raw = readFileSync(filePath, 'utf8');
    expect(raw.startsWith('---\n')).toBe(true);
    expect(raw).toMatch(new RegExp(`overlay_for:\\s*${role}`));
    expect(raw).toMatch(/provider:\s*openai/);
    expect(raw).toMatch(/source:\s*'github\.com\/openai\/codex'/);
    expect(raw).toMatch(/source_paths:/);
    expect(raw).toMatch(/schema_version:\s*1/);
  });
});
