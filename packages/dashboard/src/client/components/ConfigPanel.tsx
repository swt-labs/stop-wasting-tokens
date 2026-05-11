import type { ConfigSnapshot } from '@swt-labs/shared';
import { For, Show, createSignal, type Component, type JSX } from 'solid-js';

export interface ConfigPanelProps {
  data: ConfigSnapshot | null;
  loading: boolean;
  error: string | null;
  /** ISO-8601 timestamp of the last successful fetch, or null. */
  lastFetched: string | null;
  onRefresh: () => void;
  /**
   * v2.3 Phase 03: invoked when the user clicks Save with a populated
   * `pendingEdits` tree. Body shape mirrors `ConfigUpdateBody.config` —
   * the parent wraps via `actions.applyConfigUpdate({config: body})`.
   * Returns `{ok: true}` on success or `{error: string}` on failure;
   * the panel surfaces the error inline and keeps edit mode active so
   * the user can fix and retry.
   */
  onSave: (config: unknown) => Promise<{ ok: true } | { error: string }>;
}

/**
 * Format an ISO-8601 timestamp as a relative-time string ("12s ago", "3m
 * ago", "1h ago"). Returns "—" when the input is null or invalid.
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
 * Hand-mirrored enum lists from `@swt-labs/core/types/*`. Matches the
 * `command-registry-mirror.ts` / `allowed-verbs.ts` precedent: the
 * dashboard package ships as a standalone bundle and avoids a hard
 * runtime dependency on `@swt-labs/core` for these eight enum lists.
 *
 * **Source of truth:** `packages/core/src/types/effort.ts`,
 * `autonomy.ts`, `verification.ts`, plus the inline enums in
 * `packages/core/src/config/Config.ts` (model_profile, backend,
 * prefer_teams, planning_tracking, auto_push). Sync when those move.
 *
 * The keys here name the leaf path inside the config tree, e.g.
 * `'effort'` → top-level `config.effort`. Nested enum keys use dotted
 * notation (`'telemetry.enabled'`) but none of v2.3's editable enums
 * are nested today.
 */
const CONFIG_ENUM_OPTIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  effort: ['thorough', 'balanced', 'fast', 'turbo'],
  autonomy: ['cautious', 'standard', 'confident', 'pure-vibe'],
  verification_tier: ['quick', 'standard', 'deep'],
  model_profile: ['quality', 'balanced', 'cost'],
  backend: ['codex', 'claude-code', 'ollama'],
  prefer_teams: ['auto', 'always', 'never'],
  planning_tracking: ['manual', 'ignore', 'commit'],
  auto_push: ['never', 'after_phase', 'always'],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ── view-mode rendering (Phase 02 baseline) ────────────────────────── */

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

/* ── edit-mode rendering (v2.3 Phase 03) ────────────────────────────── */

/**
 * Render an editable input for a primitive value. Branches on JS type and
 * checks `CONFIG_ENUM_OPTIONS` for known-enum keys. The caller passes
 * `onChange` so the parent's `pendingEdits` signal stays the single
 * source of truth — this component is fully controlled.
 */
function ConfigEditLeaf(props: {
  keyName: string;
  value: unknown;
  disabled: boolean;
  onChange: (next: unknown) => void;
}): JSX.Element {
  const enumOptions = CONFIG_ENUM_OPTIONS[props.keyName];
  if (enumOptions !== undefined) {
    return (
      <select
        class="config-edit-select"
        disabled={props.disabled}
        value={typeof props.value === 'string' ? props.value : ''}
        onChange={(e): void => props.onChange(e.currentTarget.value)}
      >
        <For each={enumOptions}>{(opt): JSX.Element => <option value={opt}>{opt}</option>}</For>
      </select>
    );
  }
  if (typeof props.value === 'boolean') {
    return (
      <input
        type="checkbox"
        class="config-edit-toggle"
        disabled={props.disabled}
        checked={props.value}
        onChange={(e): void => props.onChange(e.currentTarget.checked)}
      />
    );
  }
  if (typeof props.value === 'number') {
    return (
      <input
        type="number"
        class="config-edit-input"
        disabled={props.disabled}
        value={String(props.value)}
        onInput={(e): void => {
          const n = Number.parseFloat(e.currentTarget.value);
          if (Number.isFinite(n)) props.onChange(n);
        }}
      />
    );
  }
  if (typeof props.value === 'string') {
    return (
      <input
        type="text"
        class="config-edit-input"
        disabled={props.disabled}
        value={props.value}
        onInput={(e): void => props.onChange(e.currentTarget.value)}
      />
    );
  }
  // null / undefined / objects-as-leaf: read-only display in edit mode.
  // Nested objects recurse via ConfigEditTree; this branch is for
  // unsupported leaf types (rare in SwtConfig).
  return <span class="config-tree-value-null">{JSON.stringify(props.value)}</span>;
}

function ConfigEditTree(props: {
  value: Record<string, unknown>;
  depth: number;
  disabled: boolean;
  /** Fires when any leaf changes; receives the FULL new tree at this node. */
  onChange: (next: Record<string, unknown>) => void;
}): JSX.Element {
  const entries = (): Array<[string, unknown]> => Object.entries(props.value);

  const updateLeaf = (key: string, next: unknown): void => {
    props.onChange({ ...props.value, [key]: next });
  };

  return (
    <dl class={`config-tree config-tree-depth-${props.depth}`}>
      <For each={entries()}>
        {([key, value]): JSX.Element => (
          <Show
            when={isObject(value)}
            fallback={
              <>
                <dt class="config-tree-key">{key}</dt>
                <dd class="config-tree-leaf">
                  <ConfigEditLeaf
                    keyName={key}
                    value={value}
                    disabled={props.disabled}
                    onChange={(next): void => updateLeaf(key, next)}
                  />
                </dd>
              </>
            }
          >
            <dt class="config-tree-key">{key}</dt>
            <dd>
              <details class="config-tree-nested">
                <summary class="config-tree-nested-summary">{`{ ${Object.keys(value as Record<string, unknown>).length} keys }`}</summary>
                <ConfigEditTree
                  value={value as Record<string, unknown>}
                  depth={props.depth + 1}
                  disabled={props.disabled}
                  onChange={(nestedNext): void => updateLeaf(key, nestedNext)}
                />
              </details>
            </dd>
          </Show>
        )}
      </For>
    </dl>
  );
}

/* ── ConfigPanel ────────────────────────────────────────────────────── */

export const ConfigPanel: Component<ConfigPanelProps> = (props) => {
  const [pendingEdits, setPendingEdits] = createSignal<Record<string, unknown> | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const sourceLabel = (): string =>
    props.data?.source === 'file' ? 'file' : props.data?.source === 'default' ? 'default' : '—';

  const isEditing = (): boolean => pendingEdits() !== null;

  const handleEdit = (): void => {
    const cfg = props.data?.config;
    if (!isObject(cfg)) return;
    setSaveError(null);
    // Shallow clone is sufficient — ConfigEditTree's recursive onChange
    // propagates new sub-trees up to the root signal, so the caller
    // never mutates the original.
    setPendingEdits({ ...cfg });
  };

  const handleCancel = (): void => {
    setPendingEdits(null);
    setSaveError(null);
  };

  const handleSave = async (): Promise<void> => {
    const edits = pendingEdits();
    if (edits === null) return;
    setSaving(true);
    setSaveError(null);
    const result = await props.onSave(edits);
    setSaving(false);
    if ('error' in result) {
      setSaveError(result.error);
      return;
    }
    setPendingEdits(null);
  };

  return (
    <section class="panel tools-panel config-panel" aria-label="Config">
      <header class="tools-panel-header">
        <h2 class="panel-header">Config</h2>
        <div class="tools-panel-actions">
          <Show when={!isEditing()}>
            <button
              type="button"
              class="tools-refresh-btn"
              aria-label="Refresh config"
              disabled={props.loading}
              onClick={props.onRefresh}
            >
              ↻
            </button>
            <button
              type="button"
              class="config-edit-btn"
              aria-label="Edit config"
              disabled={props.loading || !isObject(props.data?.config)}
              onClick={handleEdit}
            >
              Edit
            </button>
          </Show>
          <Show when={isEditing()}>
            <button
              type="button"
              class="config-cancel-btn"
              disabled={saving()}
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              class="config-save-btn"
              disabled={saving()}
              onClick={() => void handleSave()}
            >
              {saving() ? 'Saving…' : 'Save'}
            </button>
          </Show>
        </div>
      </header>
      <p class="tools-panel-meta">
        Source: {sourceLabel()} · {formatRelative(props.lastFetched)}
      </p>
      <Show when={props.data?.is_initialized === false}>
        <p class="tools-panel-banner">Default config (no project initialized yet)</p>
      </Show>
      <Show when={saveError()}>
        <p class="tools-panel-error">⚠ {saveError()}</p>
      </Show>
      <Show when={props.error && !saveError()}>
        <p class="tools-panel-error">⚠ {props.error}</p>
      </Show>
      <Show
        when={isEditing()}
        fallback={
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
        }
      >
        <ConfigEditTree
          value={pendingEdits() ?? {}}
          depth={0}
          disabled={saving()}
          onChange={(next): void => {
            setPendingEdits(next);
          }}
        />
      </Show>
    </section>
  );
};
