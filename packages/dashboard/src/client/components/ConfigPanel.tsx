import type { ConfigSnapshot } from '@swt-labs/dashboard-core';
import { For, Show, type Component, type JSX } from 'solid-js';

export interface ConfigPanelProps {
  data: ConfigSnapshot | null;
  loading: boolean;
  error: string | null;
  /** ISO-8601 timestamp of the last successful fetch, or null. */
  lastFetched: string | null;
  onRefresh: () => void;
}

/**
 * Format an ISO-8601 timestamp as a relative-time string ("12s ago",
 * "3m ago", "1h ago"). Returns "—" when the input is null or invalid.
 *
 * Recomputed inside the render so the value stays current as Solid's
 * reactive scheduler ticks. The 60 s polling cycle keeps the
 * `lastFetched` prop refreshing on its own; this helper just localizes
 * the string for the panel-meta line.
 */
function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/**
 * Render a primitive config value with a small visual cue per type.
 * Booleans get green/red chips; numbers + strings render in a
 * monospace span. Other primitives fall through to JSON.stringify.
 */
function renderPrimitive(value: unknown): JSX.Element {
  if (typeof value === 'boolean') {
    return (
      <span class={`config-tree-value-bool config-tree-value-bool-${value ? 'true' : 'false'}`}>
        {String(value)}
      </span>
    );
  }
  if (typeof value === 'number') {
    return <span class="config-tree-value-num">{value}</span>;
  }
  if (typeof value === 'string') {
    return <span class="config-tree-value-str">"{value}"</span>;
  }
  if (value === null) {
    return <span class="config-tree-value-null">null</span>;
  }
  return <span class="config-tree-value-str">{JSON.stringify(value)}</span>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively render a key/value tree for an arbitrary config object.
 * Top-level entries render flat; nested objects collapse into
 * `<details>` so deep configs don't crowd the panel by default.
 */
function ConfigTree(props: { value: unknown; depth: number }): JSX.Element {
  if (!isObject(props.value)) {
    return <div class="config-tree-leaf">{renderPrimitive(props.value)}</div>;
  }
  const entries = Object.entries(props.value);
  return (
    <dl class={`config-tree config-tree-depth-${props.depth}`}>
      <For each={entries}>
        {([key, value]): JSX.Element => (
          <Show
            when={isObject(value)}
            fallback={
              <>
                <dt class="config-tree-key">{key}</dt>
                <dd class="config-tree-leaf">{renderPrimitive(value)}</dd>
              </>
            }
          >
            <dt class="config-tree-key">{key}</dt>
            <dd>
              <details class="config-tree-nested">
                <summary class="config-tree-nested-summary">{`{ ${Object.keys(value as Record<string, unknown>).length} keys }`}</summary>
                <ConfigTree value={value} depth={props.depth + 1} />
              </details>
            </dd>
          </Show>
        )}
      </For>
    </dl>
  );
}

export const ConfigPanel: Component<ConfigPanelProps> = (props) => {
  const sourceLabel = (): string =>
    props.data?.source === 'file' ? 'file' : props.data?.source === 'default' ? 'default' : '—';

  return (
    <section class="panel tools-panel config-panel" aria-label="Config">
      <header class="tools-panel-header">
        <h2 class="panel-header">Config</h2>
        <button
          type="button"
          class="tools-refresh-btn"
          aria-label="Refresh config"
          disabled={props.loading}
          onClick={props.onRefresh}
        >
          ↻
        </button>
      </header>
      <p class="tools-panel-meta">
        Source: {sourceLabel()} · {formatRelative(props.lastFetched)}
      </p>
      <Show when={props.data?.is_initialized === false}>
        <p class="tools-panel-banner">Default config (no project initialized yet)</p>
      </Show>
      <Show when={props.error}>
        <p class="tools-panel-error">⚠ {props.error}</p>
      </Show>
      <Show
        when={props.data}
        fallback={
          <Show
            when={props.loading}
            fallback={<p class="tools-panel-empty">No config loaded yet.</p>}
          >
            <p class="tools-panel-empty">Loading…</p>
          </Show>
        }
      >
        {(data): JSX.Element => <ConfigTree value={data().config} depth={0} />}
      </Show>
    </section>
  );
};
