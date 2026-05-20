/**
 * v2 statusline (statusline_v2.md) — single-line bottom developer status bar.
 *
 * Originally landed as Plan 02-01 T2 (milestone 08) and extended to 14
 * cells via the statusline-extension milestone. v2 replaces the connection
 * dot's keychain-availability proxy with the actual SSE connection state
 * (Wave 1, this commit) and continues iterating through Waves 2-6 per
 * `a_non_production_files/statusline_v2.md`.
 *
 * Connection-dot semantics (Wave 1):
 *
 *   - Source of truth is `state.connection` (`ConnectionState` from
 *     `dashboard-store.ts:63`): `'connecting' | 'syncing' | 'connected' |
 *     'error'`. The previous v1 dot read `providerAuth.keychain_available`
 *     which conflated "OS keychain reachable" with "dashboard connected"
 *     and lied during SSE drops.
 *   - Three rendered states: `'connected'` → terminal-green ● ,
 *     `'pending'` → amber ● (covers `'connecting'` and `'syncing'`),
 *     `'error'` → danger-red ●. The unfilled `○` glyph is no longer used.
 *
 * Layout invariant: single line. Overflow scrolls horizontally
 * (`overflow-x: auto; white-space: nowrap` on the bar in styles.css). No
 * responsive hiding, no two-row fallback.
 *
 * Key constraints (carried from v1):
 *
 *   - Model cells: orchestrator's resolved model id arrives via
 *     `cook.provider_selected.model`. When the cook callsite couldn't
 *     resolve a model (Pi's ModelRegistry resolved internally), the cell
 *     renders `model:—`.
 *   - Agents cell: live list/count from `state.activeAgents`. Renders
 *     `agents:N` followed by `[role:shortModel]` per agent when the list
 *     fits in ~40 chars; otherwise the count + `title` attr hold the
 *     full list. Empty Map → `agents:0`.
 *   - Context cell: cumulative session input tokens vs. the resolved
 *     orchestrator model's context window from
 *     `@swt-labs/shared/types/model-info`. Unknown model → `Yk = —`.
 *     Both unknown → `ctx —/—`.
 *   - All fallbacks use U+2014 (`—`).
 *   - The token cell uses U+219B (`↛` RIGHTWARDS ARROW WITH STROKE) as
 *     the in→out separator (Wave 3 commit 6 swaps this for `→` U+2192).
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

import { compactTokens, shortModelLabel } from '../lib/model-helpers.js';
import type { ConnectionState } from '../state/dashboard-store.js';

import type { StatuslineKnobs } from './statusline-helpers.js';

// Re-export for back-compat with existing test imports from this module
// (`dashboard-statusline.test.ts` imports `shortModelLabel` from here).
export { shortModelLabel } from '../lib/model-helpers.js';

export interface DashboardStatuslineProps {
  providerAuth: ProviderAuthSnapshot | null;
  /** Live SSE connection state (`state.connection`). Drives the dot color. */
  connectionState: ConnectionState;
  /**
   * v2 Wave 3 commit 4 — `state.activeSessionId`. When non-null a cook
   * session is in flight (orchestrator running, possibly spawning agents);
   * when null the dashboard is idle. Drives the cook indicator cell at
   * the head of the Runtime group.
   */
  activeSessionId: string | null;
  costSummary: CostSummary | null;
  /** UsageRollup is `.nullable().optional()` on the snapshot — accept both. */
  usageRollup: UsageRollup | null | undefined;
  /** Four-knob projection of the dashboard's config cell. `null` per key → `—`. */
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
 * Connection-dot source-of-truth: the live SSE `ConnectionState` from
 * `state.connection`. Replaces the v1 `keychain_available` proxy (which
 * conflated OS-keychain availability with SSE health).
 *
 *   - `'connected'`              → 'connected' (terminal-green)
 *   - `'connecting' | 'syncing'` → 'pending'   (amber)
 *   - `'error'`                  → 'error'     (danger-red)
 */
export function connectionDotState(
  connectionState: ConnectionState,
): 'connected' | 'pending' | 'error' {
  if (connectionState === 'connected') return 'connected';
  if (connectionState === 'error') return 'error';
  return 'pending';
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

/**
 * v2 Wave 3 commit 6 — canonical `<label>: <value>` formatter (with one
 * space after the colon). Replaces v1's per-cell ad-hoc concatenation
 * which mixed `label:value` (no space, knobs) with `label: value`
 * (with space, money rollups) inconsistently. Unknown values render
 * as a single em-dash so the cell reads as `<label>: —`.
 */
export function formatStatuslineLabeled(
  label: string,
  value: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return `${label}: —`;
  return `${label}: ${value}`;
}

/**
 * Format the in→out token cell as `in: <in> → out: <out>`.
 *
 *   - both null/undefined           → `in: — → out: —`
 *   - single null/undefined side    → that side renders `—`
 *   - separator is U+2192 (RIGHTWARDS ARROW)
 *
 * v2 Wave 3 commit 6 dropped the v1 paren wrapper (`(in↛out)`) and the
 * U+219B "arrow-with-stroke" glyph — both fought legibility in dense
 * monospace output. The standard `→` glyph is universally rendered
 * across the JetBrains Mono / ui-monospace stack used by the bar.
 */
export function formatStatuslineTokens(
  inTokens: number | null | undefined,
  outTokens: number | null | undefined,
): string {
  const inText = compactTokens(inTokens);
  const outText = compactTokens(outTokens);
  return `in: ${inText} → out: ${outText}`;
}

/**
 * Format a `UsageWindow` rollup cell as `<label>: <dollar>` (e.g.
 * `7d: $2.10`). When the window is null/undefined (no aggregator data
 * yet) the cell renders `<label>: —` — an existing window with a
 * literal `0` cost is renderable (`<label>: $0.0000`), only the missing
 * window object falls back to the em-dash.
 *
 * v2 Wave 3 commit 6 — space after the colon (was `7d:$2.10`, now
 * `7d: $2.10`) to match the `<label>: <value>` convention across
 * every cell.
 */
export function formatStatuslineRollup(
  window: UsageWindow | null | undefined,
  label: '7d' | '30d',
): string {
  if (window === null || window === undefined) return `${label}: —`;
  return `${label}: ${formatStatuslineSessionCost(window.cost_usd)}`;
}

/**
 * Format a knob cell as `<key>: <value-or-dash>` (with one space after
 * the colon). Used by the four config cells (effort / autonomy /
 * model_profile / verification_tier).
 *
 * v2 Wave 3 commit 6 — uses the shared `formatStatuslineLabeled`
 * helper. Empty-string is treated identically to `null`.
 */
export function formatStatuslineKnob(label: string, value: string | null): string {
  return formatStatuslineLabeled(label, value);
}

// shortModelLabel + compactTokens moved to `../lib/model-helpers.ts` (used by
// both <DashboardStatusline> and <ActiveAgentsPane>). Re-exported below so
// existing test imports from this module keep resolving without churn.

/**
 * The compact agents-cell payload. Returns:
 *   - `agents: —`                                   when no cook is running
 *   - `agents: N [role:short, role:short]`          when the list fits
 *   - `agents: N`                                   when the list exceeds the cap
 *
 * The cap is conservative (~40 chars after the count prefix) — wider
 * than the brief's hint but enough headroom for three running agents
 * with mid-length model ids before falling back. The full list rides
 * on the `title` attribute of the cell (App.tsx wires it) so hover
 * still surfaces every running agent + model.
 *
 * v2 Wave 3 commit 6 — empty map renders `agents: —` (not `agents: 0`)
 * so the bar's em-dash convention is uniform; `0` masquerading as
 * "no data" was U7 in statusline_v2.md. The label-value separator
 * adds a space (`agents: N`) per the `<label>: <value>` convention.
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
    return { display: 'agents: —', fullList: '', truncated: false };
  }
  const parts: string[] = [];
  for (const a of agents.values()) {
    parts.push(`${a.role}:${shortModelLabel(a.model ?? null)}`);
  }
  const fullList = parts.join(', ');
  const wantsListed = `agents: ${count} [${fullList}]`;
  if (parts.join(' | ').length <= AGENTS_LIST_CAP_CHARS) {
    return { display: wantsListed, fullList: parts.join(' | '), truncated: false };
  }
  return { display: `agents: ${count}`, fullList: parts.join(' | '), truncated: true };
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
      {/* Cell 2: connection dot — Wave 1 of v2: dot reads state.connection
          (SSE truth) instead of providerAuth.keychain_available. */}
      <span
        class={`dashboard-statusline-dot dashboard-statusline-dot-${connectionDotState(props.connectionState)}`}
      >
        ●
      </span>
      {/* Cells 3-6: knob status indicators (effort, autonomy, model, verify).
          v2 Wave 3 commit 3 — `backend` cell dropped (no v3 meaning per
          TDD3 §1.3); labels expand to readable forms; `model:` is the
          model-PROFILE knob (quality / balanced / cost), distinct from
          the orchestrator's resolved model id rendered below.
          v2 Wave 3 commit 5 — the first knob (`effort`) is the Config
          group head; `group-start` gives it the `│` leading separator
          instead of `·`. The remaining three knobs use the default `·`. */}
      <For
        each={
          [
            ['effort', props.knobs.effort],
            ['autonomy', props.knobs.autonomy],
            ['model', props.knobs.model_profile],
            ['verify', props.knobs.verification_tier],
          ] as ReadonlyArray<readonly [string, string | null]>
        }
      >
        {(pair, index) => (
          <span
            class={`dashboard-statusline-cell dashboard-statusline-knob${
              index() === 0 ? ' group-start' : ''
            }`}
          >
            {formatStatuslineKnob(pair[0], pair[1])}
          </span>
        )}
      </For>
      {/* Cell 7: cook indicator (Runtime-group head).
          v2 Wave 3 commit 4 — `cook: running` (terminal-green) when a
          cook session is in flight, `cook: idle` (slate-muted) otherwise.
          Source is `props.activeSessionId !== null`. Locked Decision #18:
          when truly idle the explicit `idle` value reads better than
          `—` (which would imply "unknown").
          v2 Wave 3 commit 5 — `group-start` marks this as the head of
          the Runtime group so it renders a leading `│` instead of `·`. */}
      <span
        class={`dashboard-statusline-cell dashboard-statusline-cook group-start ${
          props.activeSessionId !== null ? 'is-running' : 'is-idle'
        }`}
      >
        cook: {props.activeSessionId !== null ? 'running' : 'idle'}
      </span>
      {/* Cell 8: orchestrator model.
          v2 Wave 3 commit 3 — relabelled from `model:` to `orchestrator:`
          (Locked Decision #15) so the resolved-model display does not
          collide with the model-profile knob above. */}
      <span class="dashboard-statusline-cell dashboard-statusline-model">
        {formatStatuslineLabeled('orchestrator', shortModelLabel(props.orchestratorModel))}
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
      {/* Cell 11: session cost (Money-group head).
          v2 Wave 3 commit 5 — `group-start` renders the leading `│`
          before the Money section. (Wave 5 commit 10 will swap this
          marker to the new `rate:` cell once that lands at the head
          of the Money group.) */}
      <span class="dashboard-statusline-cell group-start">
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
