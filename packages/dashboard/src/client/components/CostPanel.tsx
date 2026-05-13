import type { CostSummary } from '@swt-labs/shared';
import { Show, type Component } from 'solid-js';

export interface CostPanelProps {
  cost: CostSummary | null;
}

function fmt(usd: number | undefined): string {
  if (usd === undefined || Number.isNaN(usd)) return '—';
  if (usd === 0) return '$0.00';
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Exported for unit testing — see `cost-panel-helpers.test.ts`. */
export function formatCacheHitRatio(ratio: number | undefined): string {
  if (ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Exported for unit testing. */
export function formatTokenCount(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString();
}

export const CostPanel: Component<CostPanelProps> = (props) => {
  const cost = (): CostSummary | null => props.cost ?? null;

  return (
    <section class="panel cost-panel" aria-label="Cost summary">
      <h2 class="panel-header">Cost</h2>
      <div class="cost-panel-grid">
        <div class="cost-panel-cell">
          <div class="cost-panel-value">{fmt(cost()?.this_session_usd)}</div>
          <div class="cost-panel-label">this session</div>
        </div>
        <div class="cost-panel-cell">
          <div class="cost-panel-value">{fmt(cost()?.this_phase_usd)}</div>
          <div class="cost-panel-label">this phase</div>
        </div>
        <div class="cost-panel-cell">
          <div class="cost-panel-value">{fmt(cost()?.this_milestone_usd)}</div>
          <div class="cost-panel-label">this milestone</div>
        </div>
        <div class="cost-panel-cell">
          <div class="cost-panel-value">{fmt(cost()?.today_usd)}</div>
          <div class="cost-panel-label">today</div>
        </div>
        <div class="cost-panel-cell">
          <div class="cost-panel-value">{fmt(cost()?.total_usd)}</div>
          <div class="cost-panel-label">total</div>
        </div>
      </div>
      <Show when={cost()?.cache_hit_ratio !== undefined}>
        <div class="cost-panel-cache">
          <span class="cost-panel-cache-label">cache hit ratio</span>
          <strong>{formatCacheHitRatio(cost()!.cache_hit_ratio)}</strong>
        </div>
      </Show>
      <Show when={cost()?.tokens}>
        <details class="cost-panel-tokens">
          <summary>Tokens</summary>
          <table>
            <tbody>
              <tr>
                <th>input</th>
                <td>{formatTokenCount(cost()!.tokens!.in)}</td>
              </tr>
              <tr>
                <th>output</th>
                <td>{formatTokenCount(cost()!.tokens!.out)}</td>
              </tr>
              <tr>
                <th>cache creation</th>
                <td>{formatTokenCount(cost()!.tokens!.cache_creation)}</td>
              </tr>
              <tr>
                <th>cache read</th>
                <td>{formatTokenCount(cost()!.tokens!.cache_read)}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </Show>
      <Show when={cost()?.budget}>
        <div class="cost-panel-budget">
          <span class="cost-panel-budget-label">phase budget</span>
          <span>
            {fmt(cost()!.budget!.phase_limit_usd)} ({(cost()!.budget!.spent_pct * 100).toFixed(0)}%
            spent)
          </span>
        </div>
      </Show>
    </section>
  );
};
