/**
 * Plan 01-01 (Options Menu Consolidation) — the controlled recursive config
 * editor mounted into `OptionsMenu`'s Advanced section.
 *
 * Ported from `ConfigPanel`'s `ConfigEditTree` with two structural changes:
 *
 *   1. **Controlled** — no internal `pendingEdits` signal, no Edit/Cancel/Save
 *      buttons. The parent (`OptionsMenu`, wired in plan 01-02) owns the
 *      `pendingEdits` tree and is notified via `onChange(path, value)` when a
 *      leaf is edited. Save/Discard live at the Options level.
 *
 *   2. **Depth-1 entries render flat** — no top-level `<details>`. Depth-2+
 *      nested objects MAY keep `<details>` as a layout aid to avoid
 *      overwhelming the popover (the current SwtConfig schema is mostly flat,
 *      but the renderer must not silently break if a nested object is added).
 *
 * Per-leaf input types are unchanged from `ConfigPanel`: enums →
 * `<select>` driven by `CONFIG_ENUM_OPTIONS`; booleans → checkbox;
 * numbers → `<input type="number">`; strings → `<input type="text">`.
 *
 * Display-value resolution: walk `pendingEdits` along the path; if a value
 * is present (i.e. staged) use it, else fall back to the snapshot from
 * `config`. When the displayed value differs from the snapshot value the
 * wrapping element carries `data-modified="true"` so the parent's CSS pass
 * can mark staged controls (matches the convention `SettingsSection` will
 * adopt in plan 01-02).
 */

import { For, Show, type Component, type JSX } from 'solid-js';

import { CONFIG_ENUM_OPTIONS } from './config-enum-vocab.js';

/* ── pure helpers ────────────────────────────────────────────────────── */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk `obj` along `path` and return the leaf value, or `undefined` if any
 * step traverses through a non-object. Pure, exported for unit testing.
 */
export function getAtPath(obj: unknown, path: readonly string[]): unknown {
  let cursor: unknown = obj;
  for (const key of path) {
    if (!isObject(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

/**
 * True when the resolved display value differs from the snapshot value at
 * the same path — used to drive `data-modified="true"` on the wrapping
 * element. Treats `undefined` in `pendingEdits` (i.e. no staged value at
 * that path) as "not modified" regardless of snapshot.
 */
export function isPathStaged(
  pendingEdits: unknown,
  config: unknown,
  path: readonly string[],
): boolean {
  const staged = getAtPath(pendingEdits, path);
  if (staged === undefined) return false;
  const snapshot = getAtPath(config, path);
  return staged !== snapshot;
}

/* ── leaf editor ─────────────────────────────────────────────────────── */

function AdvancedConfigLeaf(props: {
  keyName: string;
  value: unknown;
  onChange: (next: unknown) => void;
}): JSX.Element {
  const enumOptions = CONFIG_ENUM_OPTIONS[props.keyName];
  if (enumOptions !== undefined) {
    return (
      <select
        class="advanced-config-select"
        aria-label={props.keyName}
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
        class="advanced-config-toggle"
        aria-label={props.keyName}
        checked={props.value}
        onChange={(e): void => props.onChange(e.currentTarget.checked)}
      />
    );
  }
  if (typeof props.value === 'number') {
    return (
      <input
        type="number"
        class="advanced-config-input"
        aria-label={props.keyName}
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
        class="advanced-config-input"
        aria-label={props.keyName}
        value={props.value}
        onInput={(e): void => props.onChange(e.currentTarget.value)}
      />
    );
  }
  // null / undefined / unsupported leaf type — read-only fallback. Matches
  // ConfigPanel's behaviour (see ConfigEditLeaf's final return).
  return <span class="advanced-config-value-null">{JSON.stringify(props.value)}</span>;
}

/* ── recursive tree ──────────────────────────────────────────────────── */

function AdvancedConfigTree(props: {
  /** The snapshot sub-tree at this path — drives shape + fallback values. */
  value: Record<string, unknown>;
  /** The full pendingEdits root — looked up via path for display values. */
  pendingEdits: unknown;
  /** The full config root — looked up via path for `data-modified` checks. */
  config: unknown;
  /** Path from the root config to `value`. Empty at the top. */
  path: readonly string[];
  /** Tree depth (0 at the top). Drives flat-vs-`<details>` rendering. */
  depth: number;
  onChange: (path: readonly string[], next: unknown) => void;
}): JSX.Element {
  const entries = (): Array<[string, unknown]> => Object.entries(props.value);

  return (
    <dl class={`advanced-config-tree advanced-config-tree-depth-${props.depth}`}>
      <For each={entries()}>
        {([key, snapshotValue]): JSX.Element => {
          const childPath = [...props.path, key];
          // Resolve display value: staged value (if any) overrides snapshot.
          const staged = getAtPath(props.pendingEdits, childPath);
          const display = staged === undefined ? snapshotValue : staged;
          const modified = (): boolean => isPathStaged(props.pendingEdits, props.config, childPath);

          return (
            <Show
              when={isObject(display)}
              fallback={
                <>
                  <dt class="advanced-config-key">{key}</dt>
                  <dd class="advanced-config-leaf" data-modified={modified() ? 'true' : undefined}>
                    <AdvancedConfigLeaf
                      keyName={key}
                      value={display}
                      onChange={(next): void => props.onChange(childPath, next)}
                    />
                  </dd>
                </>
              }
            >
              <dt class="advanced-config-key">{key}</dt>
              <dd>
                <Show
                  when={props.depth >= 1}
                  fallback={
                    // Depth-1 entries (i.e. parent depth === 0): flat, no
                    // <details> wrapper. Required by the plan to keep the
                    // top of Advanced visible at all times.
                    <AdvancedConfigTree
                      value={display as Record<string, unknown>}
                      pendingEdits={props.pendingEdits}
                      config={props.config}
                      path={childPath}
                      depth={props.depth + 1}
                      onChange={props.onChange}
                    />
                  }
                >
                  <details class="advanced-config-nested">
                    <summary class="advanced-config-nested-summary">{`{ ${
                      Object.keys(display as Record<string, unknown>).length
                    } keys }`}</summary>
                    <AdvancedConfigTree
                      value={display as Record<string, unknown>}
                      pendingEdits={props.pendingEdits}
                      config={props.config}
                      path={childPath}
                      depth={props.depth + 1}
                      onChange={props.onChange}
                    />
                  </details>
                </Show>
              </dd>
            </Show>
          );
        }}
      </For>
    </dl>
  );
}

/* ── prop contract ───────────────────────────────────────────────────── */

export interface AdvancedConfigSectionProps {
  /** Current snapshot from `state.tools.config.data.config`. */
  config: unknown;
  /**
   * Parent-owned staged edits. Same shape as `config`; a leaf present here
   * overrides the snapshot value at the same path. Pass `{}` when nothing
   * is staged.
   */
  pendingEdits: Record<string, unknown>;
  /**
   * Fired when a leaf editor stages a new value. `path` is the array of
   * keys from the root of `config`; `value` is the new leaf value. The
   * parent merges into its `pendingEdits` tree.
   */
  onChange: (path: readonly string[], value: unknown) => void;
}

/* ── component ───────────────────────────────────────────────────────── */

export const AdvancedConfigSection: Component<AdvancedConfigSectionProps> = (props) => {
  return (
    <section class="advanced-config-section" aria-label="Advanced config">
      <Show
        when={isObject(props.config)}
        fallback={<p class="tools-panel-empty">No config loaded yet.</p>}
      >
        <AdvancedConfigTree
          value={props.config as Record<string, unknown>}
          pendingEdits={props.pendingEdits}
          config={props.config}
          path={[]}
          depth={0}
          onChange={props.onChange}
        />
      </Show>
    </section>
  );
};
