import { type Component } from 'solid-js';

import type { CostSummary } from '@swt-labs/dashboard-core';

export interface CostPanelProps {
  cost: CostSummary | null;
}

function fmt(usd: number | undefined): string {
  if (usd === undefined || Number.isNaN(usd)) return '—';
  if (usd === 0) return '$0.00';
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export const CostPanel: Component<CostPanelProps> = (props) => {
  const total = (): number | undefined => props.cost?.total_usd;
  const today = (): number | undefined => props.cost?.today_usd;
  const milestone = (): number | undefined => props.cost?.this_milestone_usd;

  return (
    <section class="panel cost-panel" aria-label="Cost summary">
      <h2 class="panel-header">Cost</h2>
      <div class="cost-panel-grid">
        <div class="cost-panel-cell">
          <div class="cost-panel-value">{fmt(total())}</div>
          <div class="cost-panel-label">total</div>
        </div>
        <div class="cost-panel-cell">
          <div class="cost-panel-value">{fmt(today())}</div>
          <div class="cost-panel-label">today</div>
        </div>
        <div class="cost-panel-cell">
          <div class="cost-panel-value">{fmt(milestone())}</div>
          <div class="cost-panel-label">this milestone</div>
        </div>
      </div>
    </section>
  );
};
