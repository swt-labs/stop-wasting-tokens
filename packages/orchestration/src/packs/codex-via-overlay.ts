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

import {
  buildApplyPatchExtension,
  buildUpdatePlanExtension,
  extractOpenAI,
} from '@swt-labs/runtime';
import type { AgentRole, TaskTokenUsage } from '@swt-labs/shared';

import { loadAgentsMd } from '../context/agents-md-loader.js';
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
    // Phase 17 plan 04-01 Task 3 — DEVN-PHASE-04-ROLE-GATING:
    //   The brief §6 Phase 03 lists role-gating for update_plan as
    //   {Dev, Architect, Debugger}, but Phase 1 already established
    //   APPLY_PATCH_ELIGIBLE_ROLES = {lead, dev, qa, debugger, docs} as
    //   the authoritative "code-editing roles" constant (architect is
    //   EXCLUDED, lead/qa/docs INCLUDED). update_plan is a sibling
    //   code-editing tool for Codex; gating both on the IDENTICAL set
    //   keeps the role-eligibility surface consistent and prevents
    //   duplication of role-set constants. This deviation is
    //   pre-registered in the Phase 4 plan's `deviations:` array.
    //
    // Order matters: applyPatch BEFORE updatePlan. The spawn-snapshot
    // records `extensions_names` in declared order; the diff narrative
    // (Task 5) relies on this stable ordering to assert the OpenAI
    // diff is confined to a single trailing-position addition.
    return [
      { name: 'applyPatch' as const, factory: buildApplyPatchExtension() },
      { name: 'updatePlan' as const, factory: buildUpdatePlanExtension() },
    ];
  }

  contextFiles(turnContext: ContextFilesTurnContext): readonly string[] {
    // D4 — Phase 3 populated for AGENTS.md hierarchical walk-up.
    // `AnthropicViaPiPack` still returns `[]` (D2 isolation — the
    // Anthropic pack file is NOT edited by this milestone).
    //
    // Scout §F.3 — AGENTS.md applies to ALL roles when injected via the
    // OpenAI pack. No role-specific exclusion. The `role` field on
    // `turnContext` is accepted (interface contract) but unused inside
    // this pack body.
    //
    // The loader walks ancestors from `cwd` looking for a `.git` marker;
    // when `cwd` has no `.git` ancestor (e.g. the spawn-snapshot tool's
    // `/tmp/swt-spawn-snapshot`), the loader falls back to cwd-only,
    // finds no AGENTS.md, and returns `[]` — preserving wire-level
    // shape for cwd's without AGENTS.md content.
    return loadAgentsMd({ cwd: turnContext.cwd });
  }

  extractUsage(rawUsage: unknown): TaskTokenUsage | undefined {
    // Scout's surprise #3 — stub ctx; real (turn, model) flow at
    // event-mapper time, not spawn time. Phase 1 unwired.
    return extractOpenAI(rawUsage, { turn: 0, provider: 'openai', model: '' });
  }

  upstreamSources(): readonly UpstreamSource[] {
    // Phase 2 populated the canonical Codex template entry. Phase 3 added
    // the AGENTS.md walk-up spec source (`agents_md.rs`). Phase 5 appends
    // entry 2 — `apply_patch.lark` (the canonical Lark grammar that the
    // Phase 06 hand-rolled parser will be re-derived from). Phase 5's
    // drift automation iterates `pack.upstreamSources()` to detect when
    // an upstream artifact has drifted vs the pinned `contentHash`.
    //   - canonical template — sha256 in
    //     `references/codex/gpt-5.2-codex_instructions_template.md`
    //     frontmatter + the audit-script baseline.
    //   - agents_md.rs — sha256 of the pinned upstream at SHA 22dd9ad
    //     (Scout §E.2 live-validated).
    //   - apply_patch.lark — sha256 captured live at Phase 05 exec
    //     (2026-05-18) against openai/codex main HEAD.
    return [
      {
        url: 'https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/templates/model_instructions/gpt-5.2-codex_instructions_template.md',
        description:
          'Canonical Codex system prompt template (replaces legacy gpt_5_codex_prompt.md)',
        contentHash: '492a212d8a23be8b03c488177d8986f4db4ee54a34b2e8a60779e5e5c89a1b63',
        lastReviewedSha: '22dd9ad3929253ed24d7ee4f10f238e95ab25f37',
      },
      {
        url: 'https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/agents_md.rs',
        description:
          'Codex AgentsMdManager Rust source (walk-up + override semantics for AGENTS.md)',
        contentHash: 'ce3201eaee6cd92fa2728e526090991a9b6c2e6312b382536270d2570a45c2f9',
        lastReviewedSha: '22dd9ad3929253ed24d7ee4f10f238e95ab25f37',
      },
      {
        url: 'https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/handlers/apply_patch.lark',
        description:
          'Codex apply_patch Lark grammar (canonical parser source for Phase 6 derived parser)',
        contentHash: 'd6367f4826ed608c424b0a308f3d6163527df63c22513d089b91863552f8bfeb',
        lastReviewedSha: 'adca1b643fd0d2733030ef4fdaf5273036f02d9a',
      },
    ];
  }
}
