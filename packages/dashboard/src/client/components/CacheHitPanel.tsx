import { For, Show, createSignal, onCleanup, onMount, type Component } from 'solid-js';

/**
 * `CacheHitPanel` — live cache-hit ratio per provider per TDD2 §12.3.2 +
 * Plan 04-01 PR-33.
 *
 * Connects to `GET /api/cache-hits/sse` on mount. The route emits a
 * `cache-hit.snapshot` frame with the current `CacheHitSummary[]` on
 * connect and re-emits on every `METER_UPDATED` event.
 *
 * Display:
 *   - One row per provider with `cacheRead | cacheWrite | input` counts
 *     and the computed ratio.
 *   - Ratio colour-coded by the M4 EXIT GATE threshold per ADR-006:
 *       red    < 50% (no cache discipline)
 *       amber  50-69% (improving but not at target)
 *       green  ≥ 70% (M4 exit-gate target met)
 *   - Empty state when no providers have been recorded yet (greenfield
 *     project, or before the first session).
 *
 * Read-only — no operator controls.
 */

interface CacheHitSummaryWire {
  provider: string;
  cacheRead: number;
  cacheWrite: number;
  input: number;
  ratio: number;
}

interface CacheHitSnapshotFrameWire {
  type: 'cache-hit.snapshot';
  ts: string;
  summaries: CacheHitSummaryWire[];
}

const TARGET_RATIO = 0.7;
const AMBER_RATIO = 0.5;

export const CacheHitPanel: Component = () => {
  const [summaries, setSummaries] = createSignal<ReadonlyArray<CacheHitSummaryWire>>([]);
  const [connectionState, setConnectionState] = createSignal<'connecting' | 'open' | 'closed'>(
    'connecting',
  );
  let eventSource: EventSource | null = null;

  onMount(() => {
    eventSource = new EventSource('/api/cache-hits/sse');
    eventSource.addEventListener('cache-hit.snapshot', (e) => {
      setConnectionState('open');
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as CacheHitSnapshotFrameWire;
        setSummaries(data.summaries ?? []);
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

  const ratioClass = (r: number): string => {
    if (r >= TARGET_RATIO) return 'cache-hit-ratio cache-hit-ratio-green';
    if (r >= AMBER_RATIO) return 'cache-hit-ratio cache-hit-ratio-amber';
    return 'cache-hit-ratio cache-hit-ratio-red';
  };

  const fmtPct = (r: number): string => `${(r * 100).toFixed(1)}%`;
  const fmtCount = (n: number): string => n.toLocaleString();

  return (
    <section class="panel cache-hit-panel" aria-label="Cache hit ratio">
      <h2 class="panel-header">
        Cache hits
        <Show when={connectionState() !== 'open'}>
          <span class="cache-hit-conn-status"> ({connectionState()})</span>
        </Show>
      </h2>
      <Show
        when={summaries().length > 0}
        fallback={<div class="cache-hit-empty">No cache data yet</div>}
      >
        <table class="cache-hit-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Read</th>
              <th>Write</th>
              <th>Fresh</th>
              <th>Ratio</th>
            </tr>
          </thead>
          <tbody>
            <For each={summaries()}>
              {(row) => (
                <tr>
                  <td class="cache-hit-provider">{row.provider}</td>
                  <td class="cache-hit-count">{fmtCount(row.cacheRead)}</td>
                  <td class="cache-hit-count">{fmtCount(row.cacheWrite)}</td>
                  <td class="cache-hit-count">{fmtCount(row.input)}</td>
                  <td>
                    <span class={ratioClass(row.ratio)}>{fmtPct(row.ratio)}</span>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
};
