/**
 * `ProviderTuningPack` — Phase 17 plan 01-01 Task 2.
 *
 * The single provider-agnostic abstraction that every provider plugs into so
 * Phases 2–6 can sequentially close Codex parity gaps (canonical-template
 * overlay refresh, AGENTS.md walk-up, `update_plan` tool, drift automation
 * refactor, Lark-derived apply_patch parser) without sprouting provider-named
 * shim files on the SWT side.
 *
 * Design constraints (locked at milestone scope-time):
 *
 *   - D3 — ≤8 fields, two-provider-shared rule, no `codex_*` / `anthropic_*` /
 *     `openai_*` field names. Fields encode genuinely shared semantics
 *     between at least two providers; vendor-specific data lives on the
 *     concrete pack class.
 *   - D4 — `contextFiles(turnContext)` is the 7th declared field on the
 *     interface, designed day-1 (Phase 1) so no later phase has to
 *     re-version the contract. Phase 1 returns `[]` everywhere; Phase 3
 *     populates for AGENTS.md.
 *
 * Field count: 7 declared (`providerId`, `displayName`, `resolveOverlay`,
 * `customExtensions`, `contextFiles`, `extractUsage`, `upstreamSources`).
 * One slot is intentionally reserved under D3's ≤8 cap for a future shared
 * semantic.
 *
 * Naming rationale (Scout's surprise #1): the extensions slot is named
 * `customExtensions`, NOT `customTools`. The current `apply_patch` lives in
 * `extensions[]` and registers itself via `pi.registerTool` inside its
 * factory closure — the Pi extension factory mechanism, NOT Pi's built-in
 * `tools[]` list. Calling the field `customTools` would mislead consumers
 * into spreading the result into `tools[]` and breaking `apply_patch`.
 */

import type { AgentRole, TaskTokenUsage } from '@swt-labs/shared';

import type { SpawnAgentExtension } from './spawn-agent.js';

/**
 * Context handed to `contextFiles()` so a pack can decide what context-file
 * fragments to inject. Phase 1 packs ignore the argument and always return
 * `[]`; Phase 3 will use `cwd` to anchor an AGENTS.md walk-up and `role` to
 * decide which AGENTS.md hierarchies are relevant.
 */
export interface ContextFilesTurnContext {
  readonly cwd: string;
  readonly role: AgentRole;
}

/**
 * Upstream source a pack tracks for drift automation. Phase 5 will consume
 * these via the refactored `scripts/audit-upstream-prompts.sh` to detect
 * when an upstream prompt template has changed. Phase 1 packs return `[]`.
 */
export interface UpstreamSource {
  /** Fully-qualified URL the upstream lives at. */
  readonly url: string;
  /** Short human-readable description (used by audit output / drift alerts). */
  readonly description: string;
  /**
   * Optional commit SHA the pack was last reviewed against. When the
   * upstream HEAD diverges from this SHA, drift automation surfaces a
   * pending-review alert.
   */
  readonly lastReviewedSha?: string;
}

/**
 * Provider-tuning pack interface — implemented by `AnthropicViaPiPack` and
 * `CodexViaOverlayPack` today, plus any future provider pack (Gemini, Bedrock,
 * etc.) added without re-versioning the spawn entry points.
 */
export interface ProviderTuningPack {
  /**
   * Stable provider key — e.g. `'anthropic'`, `'openai'`. Matches
   * `SpawnAgentOptions.provider` so the registry can key off
   * `(providerId, installRoot)`.
   */
  readonly providerId: string;

  /** Human-readable label for dashboards / audit logs. */
  readonly displayName: string;

  /**
   * Returns the appended provider-overlay body for a given role, or
   * `undefined` if none exists. Accepts `'orchestrator'` because
   * `spawn-orchestrator-session.ts` queries the pack with a hardcoded
   * `'orchestrator'` role key (no `agents/swt-orchestrator.md` file
   * exists — the orchestrator's prompt is the body of `commands/cook.md`).
   *
   * Implementations should call into `readProviderOverlay()` (Codex) or
   * short-circuit (Anthropic — no `*-anthropic.md` files exist per D5).
   */
  resolveOverlay(role: AgentRole | 'orchestrator'): string | undefined;

  /**
   * Returns extension factories to merge into the resolved
   * `SpawnAgentSessionConfig.extensions[]` array.
   *
   * Phase 1 behaviors:
   *   - Codex pack returns the `applyPatch` extension for roles in
   *     `APPLY_PATCH_ELIGIBLE_ROLES` (lead, dev, qa, debugger, docs);
   *     returns `[]` for architect, scout, and orchestrator.
   *   - Anthropic pack returns `[]` for every role.
   *
   * Order contract: the call site spreads the result AFTER the fixed
   * `[resultProtocol, journal]` entries, so any returned extension lands at
   * the tail of the `extensions[]` array (preserving byte-identical order
   * with the pre-pack-refactor code path).
   */
  customExtensions(role: AgentRole | 'orchestrator'): readonly SpawnAgentExtension[];

  /**
   * Returns context-file fragments to inject into the first-turn prompt.
   * Phase 1 returns `[]` everywhere (D4 — designed day-1, lit up in Phase 3
   * for AGENTS.md walk-up). The pack-method seam stays stable across phases.
   */
  contextFiles(turnContext: ContextFilesTurnContext): readonly string[];

  /**
   * Wraps the per-provider usage extractor for turn-end accounting. Phase 1
   * delivers this as a forward-looking composition point — the call site
   * in `packages/runtime/src/events.ts` is NOT yet rewired to use the pack
   * method (Scout's surprise #3). The existing extractor dispatch in
   * `runtime/providers/extractors/index.ts` continues to handle turn-end
   * usage extraction; the pack method exists so future event-mapper
   * refactors can flow through the pack without interface churn.
   *
   * Implementations stub the `{turn, provider, model}` context with
   * `{turn: 0, provider: <pack's providerId>, model: ''}` since the real
   * turn/model values are only available at event-mapper time, not at
   * spawn-time.
   */
  extractUsage(rawUsage: unknown): TaskTokenUsage | undefined;

  /**
   * Returns the upstream sources this pack tracks for drift automation.
   * Phase 5 consumes this through the refactored
   * `scripts/audit-upstream-prompts.sh`. Phase 1 packs return `[]`.
   */
  upstreamSources(): readonly UpstreamSource[];
}
