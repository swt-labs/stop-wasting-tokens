/**
 * Phase G / Phase 1 G-R1 + G-M1 regression test for OpenAI prompt overlays.
 *
 * Two tiers (per Phase 1 R5 architect decision — see
 * .vbw-planning/phases/01-codex-cli-prompt-overlays/PARITY-REPORT.md):
 *
 *   Tier 1 — wiring correctness (ALWAYS ACTIVE).
 *     Asserts each of dev / debugger / qa OpenAI overlay files resolves
 *     to a non-empty body via `readProviderOverlay` AND appends correctly
 *     to its role prompt via `resolveSpawnAgentConfig`. Mirrors
 *     `provider-overlay.test.ts` coverage at the regression-suite surface;
 *     intentional duplication (different observability — regression suite
 *     run vs unit test run; both useful).
 *
 *   Tier 2 — quality measurement (SKIPPED until G-M2 lands).
 *     When real-cassette + non-placeholder-baseline are present, runs the
 *     parity harness twice (overlay on / off) and asserts
 *     `TpacReport.tokens_per_criterion` improves on the overlay-on run for
 *     at least 2 of the 3 roles (noise-aware threshold per research §6).
 *     Gate uses the same shape as `test/regression/agent-parity/dev.test.ts`:
 *       (a) baseline STATE.md exists AND does NOT contain "DEVN-03 placeholder",
 *       (b) cassette exists AND does NOT contain the synthetic-cassette
 *           "msg_synthetic_" sentinel (every Phase 4/5 synthetic placeholder
 *           carries that marker — grep'd at Lead pass to confirm).
 *
 * TODO(G-M2): when real cassettes + non-placeholder baseline land, Tier 2
 * activates automatically. NO code change needed in this file — the skipIf
 * gate flips by itself. Assertion shape for Tier 2 (documented here so the
 * G-M2 implementer knows exactly what to do):
 *
 *   1. For each role in [dev, debugger, qa]:
 *        - off = await runAgentParity({role, fixture: 'ref-fastapi',
 *                                      cassettePath, ...})         // provider omitted
 *        - on  = await runAgentParity({role, fixture: 'ref-fastapi',
 *                                      cassettePath, ..., provider: 'openai'})
 *        - record on.tpacReport.tokens_per_criterion <= off.tpacReport.tokens_per_criterion
 *
 *   2. Aggregate: assert at least 2 of 3 roles show improvement (noise-
 *      aware — research §6 acknowledges single-role marginal regressions
 *      are within sampling noise).
 *
 * No vendor-tool leaks: this test uses only SWT-native code; Pi 0.74 API
 * is not invoked here.
 */

import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

import {describe, expect, it, test} from 'vitest';

import {
  readProviderOverlay,
  resolveSpawnAgentConfig,
} from '../../../packages/orchestration/src/index.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');

// ── Soft-gate (R5) — mirrors dev.test.ts:25-35 pattern ─────────────────
const FIXTURE_ROOT = join(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi');
const BASELINE_STATE = join(FIXTURE_ROOT, 'v2-baseline/.swt-planning/STATE.md');
// Per-role cassettes — dev as the proxy "is a real recording present?"
// signal. If dev.jsonl is real, the others typically are too (Phase G-M2
// records the whole set together; see PHASE_G_ROADMAP.md G-M2 entry).
const CASSETTE_DEV = join(FIXTURE_ROOT, 'cassettes/dev.jsonl');

function isPlaceholderBaseline(): boolean {
  // Same shape as dev.test.ts:25-35. The DEVN-03 sentinel string is the
  // documented marker that the baseline is the synthesised Phase 6 plan
  // 06-04 T1 fixture, NOT a recorded v2.3.5 baseline.
  if (!existsSync(BASELINE_STATE)) return true;
  try {
    return readFileSync(BASELINE_STATE, 'utf-8').includes('DEVN-03 placeholder');
  } catch {
    return true;
  }
}

function isPlaceholderCassette(path: string): boolean {
  // Every Phase 4/5 synthetic cassette emits `msg_synthetic_<role>` in
  // its `message_start` event. A real recording from G-M2 will use the
  // real Anthropic / OpenAI message id (e.g., `msg_01ABC...`) and will
  // not contain this sentinel.
  if (!existsSync(path)) return true;
  try {
    return readFileSync(path, 'utf-8').includes('msg_synthetic_');
  } catch {
    return true;
  }
}

const HAS_BASELINE = !isPlaceholderBaseline();
const HAS_CASSETTE = !isPlaceholderCassette(CASSETTE_DEV);
const TIER_2_ACTIVE = HAS_BASELINE && HAS_CASSETTE;

// ── Tier 1 — wiring correctness (always active) ────────────────────────
describe('OpenAI overlay — Tier 1 (wiring correctness)', () => {
  test.each([
    ['dev'],
    ['debugger'],
    ['qa'],
  ])('%s overlay resolves to non-empty body via readProviderOverlay', (role) => {
    const body = readProviderOverlay(REPO_ROOT, role, 'openai');
    expect(body).toBeDefined();
    // Each authored overlay body is hundreds of bytes — guard against
    // accidental truncation / empty-file regression.
    expect(body!.length).toBeGreaterThan(50);
    // Frontmatter must be stripped — body must NOT start with `---`.
    expect(body!.startsWith('---')).toBe(false);
    // Intent-mirror header marker is present (authoring discipline landed).
    expect(body).toMatch(/Intent-mirror of OpenAI Codex CLI/);
  });

  test.each([
    ['dev'],
    ['debugger'],
    ['qa'],
  ])('%s overlay appends to role prompt with \\n\\n---\\n\\n separator (R1)', (role) => {
    // Drive resolveSpawnAgentConfig directly against the actual repo.
    // SpawnAgentOptions REQUIRES sessionId, cwd, installRoot, prompt;
    // model / maxTurns / taskId are optional; sessionFactory / hookEventBus
    // are also optional (defaults are fine — we never invoke the factory
    // because resolveSpawnAgentConfig is the resolution-only entry point).
    const overlayBody = readProviderOverlay(REPO_ROOT, role, 'openai');
    expect(overlayBody).toBeDefined();

    const config = resolveSpawnAgentConfig({
      role: role as 'dev' | 'debugger' | 'qa',
      prompt: 'test-prompt — never executed; resolveSpawnAgentConfig is pure',
      cwd: REPO_ROOT,
      sessionId: '00000000-0000-0000-0000-000000000000',
      installRoot: REPO_ROOT,
      provider: 'openai',
    });

    // R1 — APPEND-AFTER with `\n\n---\n\n` separator.
    expect(config.systemPrompt).toMatch(/\n\n---\n\n/);
    // The overlay body MUST be the suffix of systemPrompt.
    expect(config.systemPrompt.endsWith(overlayBody!)).toBe(true);
    // R4 — vendor-neutrality regression guard: the same role without a
    // provider returns the role prompt only (no overlay).
    const noOverlay = resolveSpawnAgentConfig({
      role: role as 'dev' | 'debugger' | 'qa',
      prompt: 'test-prompt',
      cwd: REPO_ROOT,
      sessionId: '00000000-0000-0000-0000-000000000000',
      installRoot: REPO_ROOT,
      // provider omitted — vendor-neutrality fast path
    });
    expect(noOverlay.systemPrompt.includes(overlayBody!)).toBe(false);
    // systemPrompt with overlay is strictly longer than without.
    expect(config.systemPrompt.length).toBeGreaterThan(noOverlay.systemPrompt.length);
  });
});

// ── Tier 2 — quality measurement (gated on real cassettes per R5) ──────
describe.skipIf(!TIER_2_ACTIVE)('OpenAI overlay — Tier 2 (quality measurement)', () => {
  test.each([
    ['dev'],
    ['debugger'],
    ['qa'],
  ])('%s — TpacReport.tokens_per_criterion improves with overlay on', async (_role) => {
    // TODO(G-M2): implement once real cassettes + non-placeholder
    // baseline are recorded. See file header for the assertion shape.
    // Pattern:
    //   import {runAgentParity} from '../../../packages/test-utils/src/run-agent-parity.js';
    //   const off = await runAgentParity({role, fixture: 'ref-fastapi',
    //                                     cassettePath: CASSETTE_<role>});
    //   const on  = await runAgentParity({role, fixture: 'ref-fastapi',
    //                                     cassettePath: CASSETTE_<role>,
    //                                     provider: 'openai'});
    //   expect(on.tpacReport.tokens_per_criterion)
    //     .toBeLessThanOrEqual(off.tpacReport.tokens_per_criterion);
    // Aggregated at suite level: at least 2 of 3 roles must improve.
    expect.fail('Tier 2 not yet implemented — pending G-M2 real cassettes + baseline');
  });
});

// Placeholder describe to surface the skip-reason in the regression suite
// output even when Tier 2 is gated off (a humanity-of-output aid; the
// gate itself is the contract).
describe.skipIf(TIER_2_ACTIVE)(
  'OpenAI overlay — Tier 2 skipped (cassette OR baseline placeholder — gated until G-M2)',
  () => {
    it('scaffolding placeholder — flip cassette + baseline to activate', () => {
      expect(TIER_2_ACTIVE).toBe(false);
    });
  },
);

// Resolve unused-imports for the eventual G-M2 implementation. Removing
// `resolve` would break the future implementer; keep it imported for the
// path-resolution they will need.
void resolve;
