import { Show, createSignal, onCleanup, onMount, type Component } from 'solid-js';

/**
 * `BudgetPanel` — live Budget Gate state per TDD2 §12.3.3 +
 * Plan 04-01 PR-35.
 *
 * Connects to `GET /api/budget/sse` on mount. Renders:
 *   - Current spend / ceiling / pressure as a percentage bar.
 *   - Status pill: ok / warning / paused (colour-coded).
 *   - When paused: a "Bump ceiling by $X" form that POSTs to
 *     `/api/budget/bump`. After bump, the route's snapshot stream
 *     auto-emits the new state.
 *
 * Per ADR-007: tier downgrade at 70% (`warning`), milestone pauses at
 * 95% (`paused`). Resume is bump-driven — there's no "wait it out"
 * because the meter is monotonic.
 */

interface BudgetStateWire {
  spent_usd: number;
  ceiling_usd: number;
  pressure: number;
  status: 'ok' | 'warning' | 'paused';
  warning_fired_at?: string;
  paused_at?: string;
}

interface BudgetSnapshotFrameWire {
  type: 'budget.snapshot';
  ts: string;
  state: BudgetStateWire | null;
}

const DEFAULT_BUMP_USD = 10;

function fmtUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '—';
  if (Math.abs(usd) < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export const BudgetPanel: Component = () => {
  const [state, setState] = createSignal<BudgetStateWire | null>(null);
  const [connectionState, setConnectionState] = createSignal<'connecting' | 'open' | 'closed'>(
    'connecting',
  );
  const [bumpUsd, setBumpUsd] = createSignal<string>(String(DEFAULT_BUMP_USD));
  const [bumping, setBumping] = createSignal(false);
  const [bumpError, setBumpError] = createSignal<string | null>(null);
  let eventSource: EventSource | null = null;

  onMount(() => {
    eventSource = new EventSource('/api/budget/sse');
    eventSource.addEventListener('budget.snapshot', (e) => {
      setConnectionState('open');
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as BudgetSnapshotFrameWire;
        setState(data.state);
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

  const handleBump = async (): Promise<void> => {
    const value = Number.parseFloat(bumpUsd());
    if (!Number.isFinite(value) || value <= 0) {
      setBumpError('Enter a positive dollar amount.');
      return;
    }
    setBumping(true);
    setBumpError(null);
    try {
      const res = await fetch('/api/budget/bump', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delta_usd: value }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setBumpError(err.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setBumpError(err instanceof Error ? err.message : String(err));
    } finally {
      setBumping(false);
    }
  };

  const statusClass = (s: BudgetStateWire['status'] | undefined): string => {
    if (s === 'paused') return 'budget-status budget-status-paused';
    if (s === 'warning') return 'budget-status budget-status-warning';
    return 'budget-status budget-status-ok';
  };

  return (
    <section class="panel budget-panel" aria-label="Budget Gate">
      <h2 class="panel-header">
        Budget
        <Show when={connectionState() !== 'open'}>
          <span class="budget-conn-status"> ({connectionState()})</span>
        </Show>
      </h2>
      <Show when={state() !== null} fallback={<div class="budget-empty">No budget gate wired</div>}>
        {(() => {
          const s = state();
          if (s === null) return null;
          const pct = Math.min(100, s.pressure * 100);
          return (
            <div class="budget-body">
              <div class="budget-row">
                <span class="budget-label">Spent</span>
                <span class="budget-value">{fmtUsd(s.spent_usd)}</span>
              </div>
              <div class="budget-row">
                <span class="budget-label">Ceiling</span>
                <span class="budget-value">{fmtUsd(s.ceiling_usd)}</span>
              </div>
              <div class="budget-bar">
                <div
                  class={`budget-bar-fill budget-bar-${s.status}`}
                  style={{ width: `${pct.toFixed(1)}%` }}
                  aria-label={`${pct.toFixed(1)}% of ceiling`}
                />
              </div>
              <div class="budget-row">
                <span class="budget-label">Status</span>
                <span class={statusClass(s.status)}>{s.status}</span>
              </div>
              <Show when={s.status === 'paused'}>
                <div class="budget-bump">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={bumpUsd()}
                    onInput={(e) => setBumpUsd(e.currentTarget.value)}
                    disabled={bumping()}
                    aria-label="Bump amount (USD)"
                  />
                  <button type="button" onClick={() => void handleBump()} disabled={bumping()}>
                    {bumping() ? 'Bumping…' : 'Bump ceiling'}
                  </button>
                </div>
                <Show when={bumpError() !== null}>
                  <div class="budget-bump-error">{bumpError()}</div>
                </Show>
              </Show>
            </div>
          );
        })()}
      </Show>
    </section>
  );
};
