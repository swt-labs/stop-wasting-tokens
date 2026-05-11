import type { DoctorReport } from '@swt-labs/shared';
import { For, Show, type Component, type JSX } from 'solid-js';

export interface DoctorPanelProps {
  data: DoctorReport | null;
  loading: boolean;
  error: string | null;
  lastFetched: string | null;
  onRefresh: () => void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function statusIcon(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
}

export const DoctorPanel: Component<DoctorPanelProps> = (props) => {
  const aggregateLabel = (): string => {
    const s = props.data?.overall_status;
    return s ? s.toUpperCase() : '—';
  };
  const passCount = (): number => props.data?.checks.filter((c) => c.status === 'pass').length ?? 0;
  const totalCount = (): number => props.data?.checks.length ?? 0;

  return (
    <section class="panel tools-panel doctor-panel" aria-label="Doctor">
      <header class="tools-panel-header">
        <h2 class="panel-header">Doctor</h2>
        <button
          type="button"
          class="tools-refresh-btn"
          aria-label="Refresh doctor report"
          disabled={props.loading}
          onClick={props.onRefresh}
        >
          ↻
        </button>
      </header>
      <p class="tools-panel-meta">
        <Show when={props.data} fallback={<>{formatRelative(props.lastFetched)}</>}>
          <span class={`doctor-status-pill doctor-status-pill-${props.data?.overall_status}`}>
            {aggregateLabel()}
          </span>{' '}
          · {passCount()}/{totalCount()} checks pass · {formatRelative(props.lastFetched)}
        </Show>
      </p>
      <Show when={props.error}>
        <p class="tools-panel-error">⚠ {props.error}</p>
      </Show>
      <Show
        when={props.data}
        fallback={
          <Show
            when={props.loading}
            fallback={<p class="tools-panel-empty">No doctor report loaded yet.</p>}
          >
            <p class="tools-panel-empty">Loading…</p>
          </Show>
        }
      >
        {(data): JSX.Element => (
          <ul class="doctor-check-list">
            <For each={data().checks}>
              {(check): JSX.Element => (
                <li class={`doctor-check-row doctor-check-row-${check.status}`}>
                  <span class="doctor-check-icon" aria-hidden="true">
                    {statusIcon(check.status)}
                  </span>
                  <span class="doctor-check-name">{check.name}</span>
                  <span class="doctor-check-detail">{check.detail}</span>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
    </section>
  );
};
