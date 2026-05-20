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
  GitInfo,
  ProviderAuthSnapshot,
  UsageRollup,
  UsageWindow,
} from '@swt-labs/shared';
import { For, Show, type Component } from 'solid-js';

import { compactTokens, shortModelLabel } from '../lib/model-helpers.js';
import type { ConnectionState } from '../state/dashboard-store.js';

import { formatStatuslineBranch, type StatuslineKnobs } from './statusline-helpers.js';

// Re-export for back-compat with existing test imports from this module
// (`dashboard-statusline.test.ts` imports `shortModelLabel` from here).
export { shortModelLabel } from '../lib/model-helpers.js';

export interface DashboardStatuslineProps {
  providerAuth: ProviderAuthSnapshot | null;
  /** Live SSE connection state (`state.connection`). Drives the dot color. */
  connectionState: ConnectionState;
  /**
   * v2 Wave 5 commit 9 — git project-identity payload from
   * `snapshot.git`. Drives the leftmost `repo:` + `branch:` cells.
   * Undefined when the dashboard cwd is not in a git repository — the
   * Project group is then hidden entirely (not rendered as em-dashes;
   * absence is the signal).
   */
  git: GitInfo;
  /**
   * v2 Wave 3 commit 4 — `state.activeSessionId`. When non-null a cook
   * session is in flight (orchestrator running, possibly spawning agents);
   * when null the dashboard is idle. Drives the cook indicator cell at
   * the head of the Runtime group.
   */
  activeSessionId: string | null;
  /**
   * v2 Wave 5 commit 10 — orchestrator session start timestamp (from
   * `state.orchestratorSessionStartTs`). Drives the live `rate:` cell
   * via `formatCostRate(sessionStartTs, cumulativeUsd, nowMs)`. Null
   * between sessions; the cell then renders `rate: —`.
   */
  sessionStartTs: string | null;
  /**
   * v2 Wave 5 commit 10 — monotonically-increasing "now" in milliseconds.
   * App.tsx ticks a `createSignal<number>(Date.now())` every 1s so the
   * `rate:` cell recomputes during a live session. Pure prop; the
   * component does no setInterval of its own.
   */
  nowMs: number;
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
 * v2 Wave 4 commit 7 — short hover tooltip for the connection dot.
 * Wave 5 commit 11 will extend this with SSE round-trip latency when
 * connected and last-event age when pending; for commit 7 the tooltip
 * is just a state label.
 */
export function connectionDotTooltip(connectionState: ConnectionState): string {
  if (connectionState === 'connected') return 'Connected — SSE stream open';
  if (connectionState === 'syncing') return 'Syncing — replaying state from server';
  if (connectionState === 'connecting') return 'Connecting — SSE stream opening';
  return 'Connection error — SSE stream disconnected';
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
 * Statusline v2 Wave 5 commit 10 — live cost-rate cell at the head of
 * the Money group.
 *
 *   - No active session (`sessionStartTs === null`)            → `rate: —`
 *   - Cumulative cost missing / NaN                            → `rate: —`
 *   - Sub-$1/min rate                                          → `rate: $0.XXXX/min`
 *   - ≥ $1/min rate                                            → `rate: $X.XX/min`
 *
 * `nowMs` is provided by App.tsx via a 1Hz `createSignal<number>` so
 * Solid recomputes the memo every second while a session runs. Elapsed
 * minutes is clamped to a 0.01-minute floor (~0.6s) to avoid the
 * divide-by-zero blast right after `cook.priority_decision` arrives.
 */
export function formatCostRate(
  sessionStartTs: string | null,
  cumulativeUsd: number | null | undefined,
  nowMs: number,
): string {
  if (sessionStartTs === null) return 'rate: —';
  if (cumulativeUsd === null || cumulativeUsd === undefined || Number.isNaN(cumulativeUsd)) {
    return 'rate: —';
  }
  const startMs = Date.parse(sessionStartTs);
  if (Number.isNaN(startMs)) return 'rate: —';
  const elapsedMin = Math.max(0.01, (nowMs - startMs) / 60_000);
  const ratePerMin = cumulativeUsd / elapsedMin;
  if (ratePerMin < 1) return `rate: $${ratePerMin.toFixed(4)}/min`;
  return `rate: $${ratePerMin.toFixed(2)}/min`;
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

  const providerName = (): string => formatStatuslineProvider(providerAuth()?.selected_provider);
  return (
    <div class="dashboard-statusline" aria-label="Dashboard statusline">
      {/* v2 Wave 5 commit 9 — Project group (leftmost). Renders ONLY when
          `props.git` is present. When the dashboard cwd is non-git the
          group is hidden entirely (no `repo: —`/`branch: —` placeholders
          — absence IS the signal that SWT is managing a non-git
          workspace). Detached HEAD lights the branch cell amber via
          `data-detached="true"`. */}
      <Show when={props.git !== undefined}>
        {(g) => (
          <>
            <span
              class="dashboard-statusline-cell dashboard-statusline-repo"
              title={
                g().repo_url_path !== null
                  ? `Repository: ${g().repo_url_path} (origin)`
                  : 'Local-only repository — no origin remote configured'
              }
            >
              repo: {g().repo_basename}
            </span>
            <span
              class="dashboard-statusline-cell dashboard-statusline-branch"
              data-detached={g().detached ? 'true' : undefined}
              title={
                g().detached
                  ? `Detached HEAD at ${g().short_sha}`
                  : `Branch: ${g().branch} · HEAD: ${g().short_sha}`
              }
            >
              branch: {formatStatuslineBranch(g().branch, g().detached, g().short_sha)}
            </span>
          </>
        )}
      </Show>
      {/* Cell 1: provider — Identity-group head. When the Project group
          (above) renders, the provider cell becomes the first cell of
          the Identity group and receives the `│` group separator via
          `group-start`. When the Project group is hidden, the provider
          cell's leading separator is suppressed by the existing
          `:first-of-type` rule. */}
      <span
        class={`dashboard-statusline-cell${props.git !== undefined ? ' group-start' : ''}`}
        title={`Provider: ${providerName()} — switch via the Provider menu`}
      >
        {providerName()}
      </span>
      {/* Cell 2: connection dot — Wave 1 of v2: dot reads state.connection
          (SSE truth) instead of providerAuth.keychain_available.
          Wave 4 commit 7: tooltip describes the state; Wave 5 commit 11
          will extend with SSE latency. */}
      <span
        class={`dashboard-statusline-dot dashboard-statusline-dot-${connectionDotState(props.connectionState)}`}
        title={connectionDotTooltip(props.connectionState)}
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
          instead of `·`. The remaining three knobs use the default `·`.
          v2 Wave 4 commit 7 — each knob carries a `title` attribute
          explaining the value and pointing the user to the Settings UI. */}
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
            title={`${pair[0][0].toUpperCase()}${pair[0].slice(1)}: ${
              pair[1] ?? '—'
            } — tunable via Settings`}
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
        title={
          props.activeSessionId !== null
            ? `Cook session running — id ${props.activeSessionId.slice(0, 8)}`
            : 'No cook session running — start one from the prompt card'
        }
      >
        cook: {props.activeSessionId !== null ? 'running' : 'idle'}
      </span>
      {/* Cell 8: orchestrator model.
          v2 Wave 3 commit 3 — relabelled from `model:` to `orchestrator:`
          (Locked Decision #15) so the resolved-model display does not
          collide with the model-profile knob above. */}
      <span
        class="dashboard-statusline-cell dashboard-statusline-model"
        title={
          props.orchestratorModel !== null
            ? `Orchestrator model: ${props.orchestratorModel}`
            : 'Orchestrator model not yet resolved (no cook session, or Pi resolved internally)'
        }
      >
        {formatStatuslineLabeled('orchestrator', shortModelLabel(props.orchestratorModel))}
      </span>
      {/* Cell 9: agents — title carries the full role:model list when the
          inline display was truncated; v2 Wave 4 commit 7 ALSO falls back
          to a generic explainer when nothing is running so every cell
          has a tooltip. */}
      <span
        class={`dashboard-statusline-cell dashboard-statusline-agents${agentsCell().truncated ? ' dashboard-statusline-agents-truncated' : ''}`}
        title={
          agentsCell().fullList || 'No agents running — populates while a cook session spawns sub-agents'
        }
      >
        {agentsCell().display}
      </span>
      {/* Cell 10: context estimate (replaces the static `ctx —/—` placeholder).
          v2 Wave 4 commit 7 — title explains the `~Xk/Yk` shape and
          reminds the reader that the estimate is per-session, not
          dashboard-lifetime. */}
      <span
        class="dashboard-statusline-cell"
        title="Context estimate — per-session input tokens used / orchestrator model's context window"
      >
        {formatContextEstimate(props.cumulativeInputTokens, props.contextWindow)}
      </span>
      {/* Cell 11: live cost-rate (Money-group head as of v2 Wave 5
          commit 10). Renders `rate: $X.XX/min` when a session is
          running; `rate: —` between sessions. `group-start` shifts
          the leading `│` from the session-cost cell (where it lived
          in Wave 3 commit 5) to here. `.is-rate` earmarks the cell
          for Wave 5 commit 12's 200ms color transition. */}
      <span
        class="dashboard-statusline-cell is-rate group-start"
        title="Live cost rate — $/min derived from this session's elapsed time + cumulative cost"
      >
        {formatCostRate(
          props.sessionStartTs,
          costSummary()?.this_session_usd,
          props.nowMs,
        )}
      </span>
      {/* Cell 12: session cost. The cell still carries the `is-cost`
          class so Wave 5 commit 12's color transition applies here
          too. */}
      <span
        class="dashboard-statusline-cell is-cost"
        title={`Session cost — total $ spent this orchestrator session: ${formatStatuslineSessionCost(
          costSummary()?.this_session_usd,
        )}`}
      >
        {formatStatuslineSessionCost(costSummary()?.this_session_usd)}
      </span>
      {/* Cell 12: tokens (in → out). */}
      <span
        class="dashboard-statusline-cell is-cost"
        title="Session tokens — input → output for the current orchestrator session"
      >
        {formatStatuslineTokens(costSummary()?.tokens?.in, costSummary()?.tokens?.out)}
      </span>
      {/* Cell 13: 7d rolling cost. */}
      <span
        class="dashboard-statusline-cell is-cost is-rollup"
        title="Rolling cost — total $ spent across the last 7 days (all sessions)"
      >
        {formatStatuslineRollup(usageRollup()?.window_7d, '7d')}
      </span>
      {/* Cell 14: 30d rolling cost. */}
      <span
        class="dashboard-statusline-cell is-cost is-rollup"
        title="Rolling cost — total $ spent across the last 30 days (all sessions)"
      >
        {formatStatuslineRollup(usageRollup()?.window_30d, '30d')}
      </span>
    </div>
  );
};
