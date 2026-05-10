import type { UpdateReport } from '@swt-labs/dashboard-core';
import { Show, type Component, type JSX } from 'solid-js';

export interface UpdatePanelProps {
  data: UpdateReport | null;
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

export const UpdatePanel: Component<UpdatePanelProps> = (props) => {
  const status = (): 'up-to-date' | 'outdated' | 'error' | 'loading' => {
    const d = props.data;
    if (!d) return 'loading';
    if (d.error !== null) return 'error';
    return d.update_available ? 'outdated' : 'up-to-date';
  };

  return (
    <section class="panel tools-panel update-panel" aria-label="Update">
      <header class="tools-panel-header">
        <h2 class="panel-header">Update</h2>
        <button
          type="button"
          class="tools-refresh-btn"
          aria-label="Refresh update check"
          disabled={props.loading}
          onClick={props.onRefresh}
        >
          ↻
        </button>
      </header>
      <p class="tools-panel-meta">
        npm registry · {formatRelative(props.lastFetched)}
      </p>
      <Show when={props.error}>
        <p class="tools-panel-error">⚠ {props.error}</p>
      </Show>
      <Show
        when={props.data}
        fallback={<p class="tools-panel-empty">Loading…</p>}
      >
        {(data): JSX.Element => (
          <div class="update-body">
            <Show when={status() === 'up-to-date'}>
              <p class="update-status update-status-up-to-date">
                ✓ Up to date (v{data().current_version})
              </p>
            </Show>
            <Show when={status() === 'outdated'}>
              <>
                <p class="update-status update-status-outdated">
                  ↑ Update available: v{data().current_version} → v{data().latest_version ?? '?'}
                </p>
                <button
                  type="button"
                  class="update-apply-btn"
                  disabled
                  title="Phase 3 of v2.3 wires this — clicking will run npm i -g stop-wasting-tokens@latest"
                >
                  Apply update
                </button>
              </>
            </Show>
            <Show when={status() === 'error'}>
              <p class="update-status update-status-error">
                ⚠ Could not check ({data().error ?? 'unknown error'})
              </p>
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
};
