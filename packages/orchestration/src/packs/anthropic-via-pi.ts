/**
 * `AnthropicViaPiPack` — Phase 17 plan 01-01 Task 3.
 *
 * The most no-op of the two reference `ProviderTuningPack` implementations.
 * Anthropic sessions run natively against Pi's defaults without any SWT-side
 * customization today, so every method short-circuits to an empty value or
 * delegates to the existing Anthropic usage extractor.
 *
 * Design ground truth:
 *   - D5 — no empty `*-anthropic.md` overlay files exist. `resolveOverlay()`
 *     returns `undefined` because no overlay file is present (matching
 *     `readProviderOverlay`'s ENOENT path), not because the pack
 *     short-circuits as a special case.
 *   - Phase 1 is a no-op refactor (D2 — provider-isolation invariant): the
 *     pre-refactor `readProviderOverlay(installRoot, role, 'anthropic')`
 *     call already returned `undefined` for every role since no overlay
 *     file exists. Returning `undefined` from `resolveOverlay()` preserves
 *     that wire-level shape byte-identically.
 *   - Scout's surprise #3 — `extractUsage()` is delivered as a forward-
 *     looking composition point. Stub ctx `{turn: 0, provider: 'anthropic',
 *     model: ''}` is acceptable in Phase 1 because the event-mapper layer
 *     (`runtime/events.ts`) still calls the existing `extractUsage`
 *     dispatcher with real ctx — the pack method is NOT yet on the call
 *     path.
 */

import { extractAnthropic } from '@swt-labs/runtime';
import type { AgentRole, TaskTokenUsage } from '@swt-labs/shared';

import type {
  ContextFilesTurnContext,
  ProviderTuningPack,
  UpstreamSource,
} from '../provider-tuning-pack.js';
import type { SpawnAgentExtension } from '../spawn-agent.js';

export class AnthropicViaPiPack implements ProviderTuningPack {
  readonly providerId = 'anthropic' as const;
  readonly displayName = 'Anthropic (via Pi)';

  // The constructor accepts (and ignores) `installRoot` for shape-symmetry
  // with `CodexViaOverlayPack` — the registry's `getProviderTuningPack`
  // factory passes installRoot to every pack regardless of provider. D5 —
  // no `*-anthropic.md` overlay files exist today, so the pack doesn't
  // need to dereference the root. When/if a future phase adds Anthropic
  // overlays, this becomes `private readonly installRoot: string` and
  // `resolveOverlay()` switches to call `readProviderOverlay(...)`.
  constructor(_installRoot: string) {}

  resolveOverlay(_role: AgentRole | 'orchestrator'): string | undefined {
    // D5 — no *-anthropic.md files exist. The pre-refactor call
    // `readProviderOverlay(installRoot, role, 'anthropic')` already returned
    // `undefined` for every role; returning `undefined` here preserves
    // byte-identical wire behavior. If a future phase introduces real
    // Anthropic overlays, this implementation switches to delegate to
    // `readProviderOverlay(this._installRoot, role, 'anthropic')`.
    return undefined;
  }

  customExtensions(_role: AgentRole | 'orchestrator'): readonly SpawnAgentExtension[] {
    // Anthropic sessions get the default extensions (resultProtocol +
    // journal) from the spawn entry points; no pack-supplied extensions.
    return [];
  }

  contextFiles(_turnContext: ContextFilesTurnContext): readonly string[] {
    // D4 — Phase 1 returns []. Phase 3 will populate for AGENTS.md.
    return [];
  }

  extractUsage(rawUsage: unknown): TaskTokenUsage | undefined {
    // Scout's surprise #3 — stub ctx; real (turn, model) flow at
    // event-mapper time, not spawn time. Phase 1 unwired.
    return extractAnthropic(rawUsage, { turn: 0, provider: 'anthropic', model: '' });
  }

  upstreamSources(): readonly UpstreamSource[] {
    // Phase 5 — surface the Claude Agent SDK type surface as a watched
    // upstream artifact so drift in `package/sdk.d.ts` is detected by
    // the weekly `swt provider-tuning-sources` → `scripts/audit-upstream-
    // prompts.sh` pipeline. The `npm:` URL-prefix convention discriminates
    // the npm-tarball fetch path from plain http(s) URLs in the audit
    // script. `lastReviewedSha` is omitted — npm tarballs carry no git
    // commit SHA. `contentHash` was captured at Phase 05 exec against
    // @anthropic-ai/claude-agent-sdk@0.3.143.
    return [
      {
        url: 'npm:@anthropic-ai/claude-agent-sdk#package/sdk.d.ts',
        description: 'Claude Agent SDK type surface (sdk.d.ts) — npm tarball fetch',
        contentHash: '7e5aa93f89a104e4ca97e931621c978affb79b3ed1aa2469db2e7307301e48be',
      },
    ];
  }
}
