/**
 * Plan 02-01 T2 (milestone 08, Phase 02) — viewport-fixed bottom statusline.
 *
 * A pure display component. Receives three snapshot-derived props from
 * App.tsx; renders six cells in a fixed left-to-right order:
 *
 *     {provider} ● ctx —/— ${session_cost} ({in}↛{out}) 7d:${week} 30d:${month}
 *
 * Key constraints (from the milestone CONTEXT.md + Scout Q1/Q2/Q10):
 *
 *   - No `{model}` cell. `ProviderAuthSnapshot` carries no model id today
 *     and surfacing a best-effort live model from `state.activeAgents`
 *     would only render while an agent is running. Re-introduce when Pi
 *     (or the runtime layer) exposes a stable per-session model id.
 *   - `ctx —/—` is a STATIC literal placeholder. Pi 0.74 exposes no
 *     context-window ceiling or running-context-tokens getter, so the
 *     em-dashes are the explicit "no data" rendering. No runtime plumbing
 *     is introduced for this milestone.
 *   - All fallbacks use U+2014 (`—`). Established convention across
 *     `CostPanel.tsx`, `ProviderAuthPanel.tsx`, etc.
 *   - The token cell uses U+219B (`↛` RIGHTWARDS ARROW WITH STROKE) as
 *     the in→out separator — distinct enough from `/` and `->` to read
 *     clearly in dense statusline output.
 *   - The connection dot derives from `providerAuth.data?.keychain_available`
 *     (the only boolean-shaped connection-state indicator available on
 *     the current `ProviderAuthSnapshot` shape — Scout Q10 Ambiguity 5).
 *   - This component does NOT fetch, run effects, or read the store. It
 *     accepts three snapshot-derived props and renders, nothing else.
 *
 * The five pure formatter helpers are exported alongside the component so
 * `packages/dashboard/test/dashboard-statusline.test.ts` can cover them
 * directly — vitest + esbuild in this workspace cannot render Solid JSX,
 * mirroring the `active-agents-pane.test.ts` pattern.
 */

import type { CostSummary, ProviderAuthSnapshot, UsageRollup, UsageWindow } from '@swt-labs/shared';
import type { Component } from 'solid-js';

export interface DashboardStatuslineProps {
  providerAuth: ProviderAuthSnapshot | null;
  costSummary: CostSummary | null;
  /** UsageRollup is `.nullable().optional()` on the snapshot — accept both. */
  usageRollup: UsageRollup | null | undefined;
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

export const DashboardStatusline: Component<DashboardStatuslineProps> = (props) => {
  // Accessor wrappers mirror `CostPanel.tsx`'s pattern. Snapshot-derived
  // props are the only input; no fetching, createEffect, or store reads
  // are introduced by this component.
  const providerAuth = (): ProviderAuthSnapshot | null => props.providerAuth ?? null;
  const costSummary = (): CostSummary | null => props.costSummary ?? null;
  const usageRollup = (): UsageRollup | null | undefined => props.usageRollup ?? null;

  return (
    <div class="dashboard-statusline" aria-label="Dashboard statusline">
      <span class="dashboard-statusline-cell">
        {formatStatuslineProvider(providerAuth()?.selected_provider)}
      </span>
      <span
        class={`dashboard-statusline-dot dashboard-statusline-dot-${connectionDotState(providerAuth())}`}
      >
        ●
      </span>
      <span class="dashboard-statusline-cell">ctx —/—</span>
      <span class="dashboard-statusline-cell">
        {formatStatuslineSessionCost(costSummary()?.this_session_usd)}
      </span>
      <span class="dashboard-statusline-cell">
        {formatStatuslineTokens(costSummary()?.tokens?.in, costSummary()?.tokens?.out)}
      </span>
      <span class="dashboard-statusline-cell">
        {formatStatuslineRollup(usageRollup()?.window_7d, '7d')}
      </span>
      <span class="dashboard-statusline-cell">
        {formatStatuslineRollup(usageRollup()?.window_30d, '30d')}
      </span>
    </div>
  );
};
