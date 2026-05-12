import { For, Show, createSignal, onCleanup, onMount, type Component } from 'solid-js';

/**
 * `ProviderCostPanel` — live per-provider cost attribution per
 * TDD2 §12.3.4 + Plan 05-01 PR-43.
 *
 * Connects to `GET /api/provider-cost/sse`. Renders one row per provider
 * with a horizontal bar showing the share-of-total cost + the raw
 * dollar amount + token counts. Operators see which provider their
 * money is flowing to in real time.
 *
 * Empty state: "No provider cost data yet" — covers the greenfield
 * daemon + the pre-first-session state.
 */

interface ProviderCostRowWire {
  provider: string;
  cost_usd: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  share_pct: number;
}

interface ProviderCostFrameWire {
  type: 'provider-cost.snapshot';
  ts: string;
  rows: ProviderCostRowWire[];
}

function fmtUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '—';
  if (Math.abs(usd) < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export const ProviderCostPanel: Component = () => {
  const [rows, setRows] = createSignal<ReadonlyArray<ProviderCostRowWire>>([]);
  const [connectionState, setConnectionState] = createSignal<'connecting' | 'open' | 'closed'>(
    'connecting',
  );
  let eventSource: EventSource | null = null;

  onMount(() => {
    eventSource = new EventSource('/api/provider-cost/sse');
    eventSource.addEventListener('provider-cost.snapshot', (e) => {
      setConnectionState('open');
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as ProviderCostFrameWire;
        setRows(data.rows ?? []);
      } catch {
        // ignore malformed frames
      }
    });
    eventSource.addEventListener('error', () => {
      setConnectionState('closed');
    });
  });

  onCleanup(() => {
    if (eventSource !== null) {
      eventSource.close();
      eventSource = null;
    }
  });

  return (
    <section class="panel provider-cost-panel" aria-label="Per-provider cost">
      <h2 class="panel-header">
        Provider cost
        <Show when={connectionState() !== 'open'}>
          <span class="provider-cost-conn-status"> ({connectionState()})</span>
        </Show>
      </h2>
      <Show
        when={rows().length > 0}
        fallback={<div class="provider-cost-empty">No provider cost data yet</div>}
      >
        <ul class="provider-cost-list">
          <For each={rows()}>
            {(row) => (
              <li class="provider-cost-row">
                <div class="provider-cost-row-header">
                  <span class="provider-cost-provider">{row.provider}</span>
                  <span class="provider-cost-amount">{fmtUsd(row.cost_usd)}</span>
                </div>
                <div class="provider-cost-bar">
                  <div
                    class="provider-cost-bar-fill"
                    style={{ width: `${Math.min(100, row.share_pct).toFixed(1)}%` }}
                    aria-label={`${row.share_pct.toFixed(1)}% share`}
                  />
                </div>
                <div class="provider-cost-row-footer">
                  <span>{row.share_pct.toFixed(1)}%</span>
                  <span>
                    in {fmtTokens(row.input)} · out {fmtTokens(row.output)} · cache R{' '}
                    {fmtTokens(row.cacheRead)} / W {fmtTokens(row.cacheWrite)}
                  </span>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
};
