/**
 * `CodexViaOverlayPack` — Phase 17 plan 01-01 Task 3.
 *
 * The Codex (OpenAI) `ProviderTuningPack` implementation. Delegates overlay
 * resolution to the existing `readProviderOverlay()` helper and supplies the
 * `apply_patch` extension for code-editing roles via `buildApplyPatchExtension`.
 * Phase 2 (overlay refresh), Phase 3 (AGENTS.md), Phase 5 (drift automation),
 * and Phase 6 (Lark parser) progressively flesh out the other methods.
 *
 * Design ground truth:
 *   - Scout's surprise #2 — `APPLY_PATCH_ELIGIBLE_ROLES` is imported from
 *     `../spawn-agent.js`, NOT redefined locally. Single source of truth;
 *     no duplication risk between this pack and the spawn entry point.
 *     Eligible: lead, dev, qa, debugger, docs. Excluded: architect, scout,
 *     orchestrator.
 *   - Scout's surprise #5 — `role === 'orchestrator'` is a valid call key.
 *     `resolveOverlay('orchestrator')` returns `undefined` because no
 *     `orchestrator-openai.md` file exists (readProviderOverlay's ENOENT
 *     path). `customExtensions('orchestrator')` returns `[]` because
 *     orchestrator is never in `APPLY_PATCH_ELIGIBLE_ROLES`.
 *   - D2 (provider-isolation invariant) — for OpenAI sessions, the
 *     resolved system prompt + extensions list must remain byte-identical
 *     to the pre-Phase-1 wire shape. This pack's
 *     `resolveOverlay`/`customExtensions` methods reproduce the exact
 *     pre-refactor logic: same overlay file path, same eligible-role set,
 *     same `applyPatch` factory call, same return order.
 */

import { buildApplyPatchExtension, extractOpenAI } from '@swt-labs/runtime';
import type { AgentRole, TaskTokenUsage } from '@swt-labs/shared';

import { readProviderOverlay } from '../provider-overlay.js';
import type {
  ContextFilesTurnContext,
  ProviderTuningPack,
  UpstreamSource,
} from '../provider-tuning-pack.js';
import { APPLY_PATCH_ELIGIBLE_ROLES, type SpawnAgentExtension } from '../spawn-agent.js';

export class CodexViaOverlayPack implements ProviderTuningPack {
  readonly providerId = 'openai' as const;
  readonly displayName = 'Codex (via overlay)';

  constructor(private readonly installRoot: string) {}

  resolveOverlay(role: AgentRole | 'orchestrator'): string | undefined {
    // Scout's surprise #5 — role === 'orchestrator' is valid. No
    // `orchestrator-openai.md` file exists today; ENOENT path yields
    // `undefined`, matching the pre-refactor wire-level shape.
    return readProviderOverlay(this.installRoot, role, 'openai');
  }

  customExtensions(role: AgentRole | 'orchestrator'): readonly SpawnAgentExtension[] {
    // Scout's surprise #2 — use the exact constant imported from
    // spawn-agent.ts, NOT a local helper. Single source of truth.
    //
    // The orchestrator role is never in APPLY_PATCH_ELIGIBLE_ROLES (a
    // ReadonlySet<AgentRole>; 'orchestrator' is in the AgentRole union but
    // explicitly NOT in this set), so the membership check naturally
    // returns `[]` for orchestrator. The explicit `role === 'orchestrator'`
    // early-return below is belt-and-suspenders documentation, not
    // load-bearing logic.
    if (role === 'orchestrator') return [];
    if (!APPLY_PATCH_ELIGIBLE_ROLES.has(role)) return [];
    return [{ name: 'applyPatch' as const, factory: buildApplyPatchExtension() }];
  }

  contextFiles(_turnContext: ContextFilesTurnContext): readonly string[] {
    // D4 — Phase 1 returns []. Phase 3 will populate for AGENTS.md.
    return [];
  }

  extractUsage(rawUsage: unknown): TaskTokenUsage | undefined {
    // Scout's surprise #3 — stub ctx; real (turn, model) flow at
    // event-mapper time, not spawn time. Phase 1 unwired.
    return extractOpenAI(rawUsage, { turn: 0, provider: 'openai', model: '' });
  }

  upstreamSources(): readonly UpstreamSource[] {
    // Phase 5 will populate with Codex prompt-mirror URLs (e.g.
    // github.com/openai/codex prompt template). Phase 1 returns [].
    return [];
  }
}
