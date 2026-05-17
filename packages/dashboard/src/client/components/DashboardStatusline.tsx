/**
 * Plan 02-01 T2 (milestone 08, Phase 02) — viewport-fixed bottom statusline.
 *
 * Statusline-extension milestone (step 5 of 8 per
 * a_non_production_files/statusline.md) — extended in place; preserves the
 * original 7 cells unchanged and prepends knob / model / agent cells plus
 * a now-live context-estimate cell that previously rendered as `ctx —/—`.
 *
 * Current cell order (left → right):
 *
 *     {provider} ● {backend} {effort} {autonomy} {profile} {tier}
 *     model:{orchestrator} agents:{N}[...]
 *     ctx {~Xk/Yk} ${session} ({in}↛{out}) 7d:${week} 30d:${month}
 *
 * Layout invariant: single line. Overflow scrolls horizontally
 * (`overflow-x: auto; white-space: nowrap` on the bar in styles.css). No
 * responsive hiding, no two-row fallback.
 *
 * Key constraints (from the milestone CONTEXT.md + Scout Q1/Q2/Q10):
 *
 *   - Model cells: orchestrator's resolved model id arrives via
 *     `cook.provider_selected.model` (commit f95441b). When the cook
 *     callsite couldn't resolve a model (Pi's ModelRegistry resolved
 *     internally), the cell renders `model:—`.
 *   - Agents cell: live list/count from `state.activeAgents`. Renders
 *     `agents:N` followed by `[role:shortModel]` per agent when the list
 *     fits in ~40 chars; otherwise the count + `title` attr hold the
 *     full list. Empty Map → `agents:0`.
 *   - Context cell: cumulative session input tokens vs. the resolved
 *     orchestrator model's context window from
 *     `@swt-labs/shared/types/model-info`. Unknown model → `Yk = —`.
 *     Both unknown → `ctx —/—`.
 *   - All fallbacks use U+2014 (`—`). Established convention across
 *     `CostPanel.tsx`, `ProviderAuthPanel.tsx`, etc.
 *   - The token cell uses U+219B (`↛` RIGHTWARDS ARROW WITH STROKE) as
 *     the in→out separator — distinct enough from `/` and `->` to read
 *     clearly in dense statusline output.
 *   - The connection dot derives from `providerAuth.data?.keychain_available`
 *     (the only boolean-shaped connection-state indicator available on
 *     the current `ProviderAuthSnapshot` shape — Scout Q10 Ambiguity 5).
 *   - This component does NOT fetch, run effects, or read the store. It
 *     accepts derived props and renders, nothing else.
 *
 * The pure formatter helpers are exported alongside the component so
 * `packages/dashboard/test/dashboard-statusline.test.ts` can cover them
 * directly — vitest + esbuild in this workspace cannot render Solid JSX,
 * mirroring the `active-agents-pane.test.ts` pattern.
 */

import type {
  AgentLiveState,
  CostSummary,
  ProviderAuthSnapshot,
  UsageRollup,
  UsageWindow,
} from '@swt-labs/shared';
import { For, type Component } from 'solid-js';

import type { StatuslineKnobs } from './statusline-helpers.js';

export interface DashboardStatuslineProps {
  providerAuth: ProviderAuthSnapshot | null;
  costSummary: CostSummary | null;
  /** UsageRollup is `.nullable().optional()` on the snapshot — accept both. */
  usageRollup: UsageRollup | null | undefined;
  /** Five-knob projection of the dashboard's config cell. `null` per key → `—`. */
  knobs: StatuslineKnobs;
  /** Resolved orchestrator model id, or `null` when the cook callsite hasn't surfaced it. */
  orchestratorModel: string | null;
  /** Live agents map (`state.activeAgents`). Empty Map → `agents:0`. */
  activeAgents: ReadonlyMap<string, AgentLiveState>;
  /**
   * Context window of the resolved orchestrator model (from
   * `getContextWindow(orchestratorModel)`), or `null` when unknown.
   */
  contextWindow: number | null;
  /**
   * Cumulative input tokens for the current orchestrator session. The
   * statusline divides this by `contextWindow` to compute the `~Xk/Yk`
   * estimate. Source: `state.snapshot.cost_summary.tokens.in` (plus
   * `cache_read + cache_creation` per artifacts.md §3 — App.tsx wires
   * the sum).
   */
  cumulativeInputTokens: number;
}

/** Returns the provider name when non-empty, otherwise the em-dash fallback. */
export function formatStatuslineProvider(provider: string | null | undefined): string {
  if (typeof provider !== 'string' || provider.length === 0) return '—';
  return provider;
}

/**
 * Connection-dot source-of-truth: `keychain_available` is the only
 * boolean-shaped connection-state indicator on `ProviderAuthSnapshot`
 * today (Scout Q10 Ambiguity 5). Anything other than a literal `true`
 * (including `null` and `undefined`) renders disconnected.
 */
export function connectionDotState(
  providerAuth: ProviderAuthSnapshot | null,
): 'connected' | 'disconnected' {
  return providerAuth?.keychain_available === true ? 'connected' : 'disconnected';
}

/**
 * Format a USD amount for the statusline.
 *
 *   - null / undefined / NaN → `$—`
 *   - usd < 1                → `$x.xxxx` (4 decimals — sub-dollar precision)
 *   - usd ≥ 1                → `$x.xx`   (2 decimals)
 *
 * Mirrors `CostPanel.tsx`'s `fmt()` convention so the statusline's dollar
 * cells match the existing right-column dollar formatting.
 */
export function formatStatuslineSessionCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return '$—';
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Compact a single token count: <1K exact, ≥1K → `NK`, ≥1M → `NM`. */
function compactTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1_000_000) return `${Math.floor(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.floor(n / 1_000)}K`;
  return `${Math.floor(n)}`;
}

/**
 * Format the in→out token cell as `(in↛out)`.
 *
 *   - both null/undefined → `(—↛—)`
 *   - single null/undefined side renders as `—`
 *   - the separator is U+219B (RIGHTWARDS ARROW WITH STROKE)
 */
export function formatStatuslineTokens(
  inTokens: number | null | undefined,
  outTokens: number | null | undefined,
): string {
  const inText = compactTokens(inTokens);
  const outText = compactTokens(outTokens);
  return `(${inText}↛${outText})`;
}

/**
 * Format a `UsageWindow` rollup cell as `<label>:<dollar>` (e.g.
 * `7d:$2.10`). When the window is null/undefined (no aggregator data
 * yet) the cell renders `<label>:—` — an existing window with a
 * literal `0` cost is renderable (`<label>:$0.0000`), only the missing
 * window object falls back to the em-dash.
 */
export function formatStatuslineRollup(
  window: UsageWindow | null | undefined,
  label: '7d' | '30d',
): string {
  if (window === null || window === undefined) return `${label}:—`;
  return `${label}:${formatStatuslineSessionCost(window.cost_usd)}`;
}

/**
 * Format a knob cell as `<key>:<value-or-dash>`. Used by the five config
 * cells (backend / effort / autonomy / model_profile / verification_tier).
 * The key is the short visual label, NOT the raw config key — keep it
 * narrow to preserve horizontal real estate.
 */
export function formatStatuslineKnob(label: string, value: string | null): string {
  return `${label}:${value === null || value.length === 0 ? '—' : value}`;
}

/**
 * Trim a model id to a short display form. Vendor canonical ids are
 * verbose (`claude-sonnet-4-6` vs. the brief's `sonnet-4-6`); the
 * statusline crops to the family suffix to keep cells narrow.
 *
 *   - `claude-sonnet-4-6`        → `sonnet-4-6`
 *   - `claude-haiku-4-5-20251001` → `haiku-4-5-20251001`
 *   - `gpt-5-codex`              → `gpt-5-codex` (no `claude-` prefix to strip)
 *   - `null` / `''`              → `—`
 *
 * Defensive: only strips the `claude-` family prefix because the
 * Anthropic ids follow a consistent `claude-{family}-N-M` pattern.
 * Other vendors render as-is.
 */
export function shortModelLabel(modelId: string | null | undefined): string {
  if (modelId === null || modelId === undefined || modelId.length === 0) return '—';
  if (modelId.startsWith('claude-')) return modelId.slice('claude-'.length);
  return modelId;
}

/**
 * The compact agents-cell payload. Returns:
 *   - `agents:0`                                  when the map is empty
 *   - `agents:N [role:short, role:short]`         when the list fits
 *   - `agents:N`                                  when the list exceeds the cap
 *
 * The cap is conservative (~40 chars after the count prefix) — wider
 * than the brief's hint but enough headroom for three running agents
 * with mid-length model ids before falling back. The full list rides
 * on the `title` attribute of the cell (App.tsx wires it) so hover
 * still surfaces every running agent + model.
 */
export interface AgentsCellResult {
  /** The display string painted into the cell. */
  display: string;
  /** Pipe-separated full list ("role:model | role:model") for the `title` attr. */
  fullList: string;
  /** Whether the display was truncated to count-only. */
  truncated: boolean;
}

const AGENTS_LIST_CAP_CHARS = 40;

export function formatAgentsCell(agents: ReadonlyMap<string, AgentLiveState>): AgentsCellResult {
  const count = agents.size;
  if (count === 0) {
    return { display: 'agents:0', fullList: '', truncated: false };
  }
  const parts: string[] = [];
  for (const a of agents.values()) {
    parts.push(`${a.role}:${shortModelLabel(a.model ?? null)}`);
  }
  const fullList = parts.join(', ');
  const wantsListed = `agents:${count} [${fullList}]`;
  if (parts.join(' | ').length <= AGENTS_LIST_CAP_CHARS) {
    return { display: wantsListed, fullList: parts.join(' | '), truncated: false };
  }
  return { display: `agents:${count}`, fullList: parts.join(' | '), truncated: true };
}

/**
 * Format the context-estimate cell as `ctx ~Xk/Yk`, where X is the
 * cumulative session input tokens (rounded down to the nearest 1k) and
 * Y is the resolved orchestrator model's context window (likewise).
 *
 *   - both unknown                  → `ctx —/—`
 *   - known cumulative, unknown window → `ctx ~Xk/—`
 *   - unknown cumulative, known window → `ctx —/Yk` (defensive; in
 *     practice `cumulativeInputTokens` is always a number ≥ 0)
 *   - both known                       → `ctx ~Xk/Yk`
 */
export function formatContextEstimate(
  cumulativeInputTokens: number | null | undefined,
  contextWindow: number | null | undefined,
): string {
  const haveTokens =
    typeof cumulativeInputTokens === 'number' && !Number.isNaN(cumulativeInputTokens);
  const haveWindow = typeof contextWindow === 'number' && contextWindow > 0;
  if (!haveTokens && !haveWindow) return 'ctx —/—';
  // Round DOWN to the nearest 1k for both sides; cumulative can be very
  // small (a fresh session has ~0) so we tolerate `0k`.
  const x = haveTokens ? `~${Math.floor(cumulativeInputTokens / 1000)}k` : '—';
  const y = haveWindow ? `${Math.floor(contextWindow / 1000)}k` : '—';
  return `ctx ${x}/${y}`;
}

export const DashboardStatusline: Component<DashboardStatuslineProps> = (props) => {
  // Accessor wrappers mirror `CostPanel.tsx`'s pattern. Snapshot-derived
  // props are the only input; no fetching, createEffect, or store reads
  // are introduced by this component.
  const providerAuth = (): ProviderAuthSnapshot | null => props.providerAuth ?? null;
  const costSummary = (): CostSummary | null => props.costSummary ?? null;
  const usageRollup = (): UsageRollup | null | undefined => props.usageRollup ?? null;
  const agentsCell = (): AgentsCellResult => formatAgentsCell(props.activeAgents);

  return (
    <div class="dashboard-statusline" aria-label="Dashboard statusline">
      {/* Cell 1: provider */}
      <span class="dashboard-statusline-cell">
        {formatStatuslineProvider(providerAuth()?.selected_provider)}
      </span>
      {/* Cell 2: connection dot */}
      <span
        class={`dashboard-statusline-dot dashboard-statusline-dot-${connectionDotState(providerAuth())}`}
      >
        ●
      </span>
      {/* Cells 3-7: knob status indicators (backend, effort, autonomy, profile, tier) */}
      <For
        each={
          [
            ['be', props.knobs.backend],
            ['eff', props.knobs.effort],
            ['auto', props.knobs.autonomy],
            ['prof', props.knobs.model_profile],
            ['ver', props.knobs.verification_tier],
          ] as ReadonlyArray<readonly [string, string | null]>
        }
      >
        {(pair) => (
          <span class="dashboard-statusline-cell dashboard-statusline-knob">
            {formatStatuslineKnob(pair[0], pair[1])}
          </span>
        )}
      </For>
      {/* Cell 8: orchestrator model */}
      <span class="dashboard-statusline-cell dashboard-statusline-model">
        model:{shortModelLabel(props.orchestratorModel)}
      </span>
      {/* Cell 9: agents */}
      <span
        class={`dashboard-statusline-cell dashboard-statusline-agents${agentsCell().truncated ? ' dashboard-statusline-agents-truncated' : ''}`}
        title={agentsCell().fullList || undefined}
      >
        {agentsCell().display}
      </span>
      {/* Cell 10: context estimate (replaces the static `ctx —/—` placeholder) */}
      <span class="dashboard-statusline-cell">
        {formatContextEstimate(props.cumulativeInputTokens, props.contextWindow)}
      </span>
      {/* Cell 11: session cost */}
      <span class="dashboard-statusline-cell">
        {formatStatuslineSessionCost(costSummary()?.this_session_usd)}
      </span>
      {/* Cell 12: tokens (in↛out) */}
      <span class="dashboard-statusline-cell">
        {formatStatuslineTokens(costSummary()?.tokens?.in, costSummary()?.tokens?.out)}
      </span>
      {/* Cell 13: 7d rolling cost */}
      <span class="dashboard-statusline-cell">
        {formatStatuslineRollup(usageRollup()?.window_7d, '7d')}
      </span>
      {/* Cell 14: 30d rolling cost */}
      <span class="dashboard-statusline-cell">
        {formatStatuslineRollup(usageRollup()?.window_30d, '30d')}
      </span>
    </div>
  );
};
