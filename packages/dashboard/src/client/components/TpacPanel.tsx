import { Show, createSignal, onCleanup, onMount, type Component } from 'solid-js';

/**
 * `TpacPanel` — TPAC (tokens-per-acceptance-criterion) history per
 * TDD2 §12.3.5 + Plan 04-01 PR-37.
 *
 * Connects to `GET /api/tpac/sse` on mount. The route emits a
 * `tpac.snapshot` frame with every recorded TpacReport (sorted by
 * `recorded_at` ascending). The panel renders:
 *   - The **latest** report's card (milestone / fixture / provider /
 *     tokens_per_criterion / criteria_satisfied / cost).
 *   - When ≥ 2 reports exist, a **delta vs baseline** badge showing
 *     the percentage change of `tokens_per_criterion` against the
 *     earliest report (reports[0]). The M4 EXIT GATE target is
 *     `-40%` vs the M2 baseline; a green arrow indicates improvement,
 *     red indicates regression.
 *   - Empty state ("No TPAC measurements yet") when the snapshot is
 *     empty.
 *
 * Read-only — operators record reports via `swt bench --output <path>`
 * and drop them under `.swt-planning/.tpac/`.
 */

interface TpacReportWire {
  schema_version: 1;
  milestone: string;
  fixture: string;
  provider: string;
  model: string;
  tpac_input: number;
  tpac_output: number;
  tpac_total: number;
  criteria_satisfied: number;
  tokens_per_criterion: number;
  cost_usd?: number;
  recorded_at: string;
}

interface TpacSnapshotFrameWire {
  type: 'tpac.snapshot';
  ts: string;
  reports: TpacReportWire[];
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtUsd(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) return '—';
  if (Math.abs(usd) < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtPercent(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export const TpacPanel: Component = () => {
  const [reports, setReports] = createSignal<ReadonlyArray<TpacReportWire>>([]);
  const [connectionState, setConnectionState] = createSignal<'connecting' | 'open' | 'closed'>(
    'connecting',
  );
  let eventSource: EventSource | null = null;

  onMount(() => {
    eventSource = new EventSource('/api/tpac/sse');
    eventSource.addEventListener('tpac.snapshot', (e) => {
      setConnectionState('open');
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as TpacSnapshotFrameWire;
        setReports(data.reports ?? []);
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

  const latest = (): TpacReportWire | undefined => {
    const r = reports();
    return r.length > 0 ? r[r.length - 1] : undefined;
  };

  const baseline = (): TpacReportWire | undefined => {
    const r = reports();
    return r.length >= 2 ? r[0] : undefined;
  };

  const deltaPct = (): number | undefined => {
    const l = latest();
    const b = baseline();
    if (l === undefined || b === undefined || b.tokens_per_criterion === 0) return undefined;
    return ((l.tokens_per_criterion - b.tokens_per_criterion) / b.tokens_per_criterion) * 100;
  };

  const deltaClass = (pct: number): string => {
    // Negative delta = TPAC went DOWN = improvement (fewer tokens per
    // criterion is better). Green when delta <= -40% (M4 target hit).
    if (pct <= -40) return 'tpac-delta tpac-delta-good';
    if (pct < 0) return 'tpac-delta tpac-delta-improving';
    if (pct === 0) return 'tpac-delta tpac-delta-flat';
    return 'tpac-delta tpac-delta-bad';
  };

  return (
    <section class="panel tpac-panel" aria-label="TPAC measurements">
      <h2 class="panel-header">
        TPAC
        <Show when={connectionState() !== 'open'}>
          <span class="tpac-conn-status"> ({connectionState()})</span>
        </Show>
      </h2>
      <Show
        when={latest() !== undefined}
        fallback={<div class="tpac-empty">No TPAC measurements yet</div>}
      >
        {(() => {
          const l = latest();
          if (l === undefined) return null;
          const dp = deltaPct();
          return (
            <div class="tpac-body">
              <div class="tpac-headline">
                <div class="tpac-headline-value">{fmtTokens(l.tokens_per_criterion)}</div>
                <div class="tpac-headline-label">tokens / criterion</div>
              </div>
              <Show when={dp !== undefined}>
                <div class={deltaClass(dp ?? 0)}>
                  {fmtPercent(dp ?? 0)} vs {baseline()?.milestone ?? '—'} baseline
                </div>
              </Show>
              <table class="tpac-table">
                <tbody>
                  <tr>
                    <th>Milestone</th>
                    <td>{l.milestone}</td>
                  </tr>
                  <tr>
                    <th>Fixture</th>
                    <td>{l.fixture}</td>
                  </tr>
                  <tr>
                    <th>Provider</th>
                    <td>
                      {l.provider} · {l.model}
                    </td>
                  </tr>
                  <tr>
                    <th>Criteria</th>
                    <td>{l.criteria_satisfied}</td>
                  </tr>
                  <tr>
                    <th>Tokens (in / out)</th>
                    <td>
                      {fmtTokens(l.tpac_input)} / {fmtTokens(l.tpac_output)}
                    </td>
                  </tr>
                  <tr>
                    <th>Cost</th>
                    <td>{fmtUsd(l.cost_usd)}</td>
                  </tr>
                  <tr>
                    <th>Recorded</th>
                    <td title={l.recorded_at}>{l.recorded_at.slice(0, 10)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}
      </Show>
    </section>
  );
};
