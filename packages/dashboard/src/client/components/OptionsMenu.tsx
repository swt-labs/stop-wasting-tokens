/**
 * Plan 01-02 (Options Menu Consolidation) — the Options dropdown now hosts
 * Commands + Settings (curated) + Advanced (full tree) + a sticky action
 * bar inline, with no per-section collapse. The popover's `Options ▾`
 * trigger remains the only collapse layer; once open, every section body
 * is visible at once.
 *
 * Architectural notes:
 *
 *   - **Open/close-CONTROLLED.** `TopBar` owns the open/close state and
 *     the trigger `ref`; this component renders the popover body. The
 *     popover mechanics (document listeners, Escape / click-outside
 *     dismissal, focus-on-open, `position: absolute` anchoring) live in
 *     the shared `<Popover>` primitive.
 *
 *   - **`pendingEdits` lives HERE.** Hoisting to the store would survive
 *     menu close, but closing the popover-as-discard is too easy to do
 *     accidentally. The local Solid signal already survives popover
 *     open/close because Solid keeps mounted children's state across
 *     hidden/visible cycles. On page reload pending edits are dropped —
 *     they were never saved.
 *
 *   - **Settings + Advanced render inline.** Plan 01-02 collapses the
 *     previous JSX-prop slot model (where `App.tsx` constructed a
 *     `<SettingsSection ...>` element and handed it in) — both Settings
 *     and Advanced live inside the popover body so they can read the
 *     local `pendingEdits` signal directly. `App.tsx` now passes the
 *     config snapshot + the Save handler instead of a JSX slot.
 *
 *   - **`commandsSection` stays a JSX slot.** Commands has no edit-state
 *     contract with the Options menu; the existing slot keeps `App.tsx`'s
 *     CommandsSection wiring intact.
 *
 * The load-bearing pure helpers (`nextMenuStateOnTriggerClick`,
 * `shouldCloseOnKey`, `shouldCloseOnOutsideClick`) moved to `Popover.tsx`;
 * they are RE-EXPORTED here unchanged so existing `options-menu.test.ts`
 * imports keep resolving.
 */

import type { ConfigSnapshot } from '@swt-labs/shared';
import { Show, createSignal, type Component, type JSX } from 'solid-js';

import { AdvancedConfigSection } from './AdvancedConfigSection.js';
import { Popover } from './Popover.js';
import { SettingsSection, mergeStagedConfig } from './SettingsSection.js';

// Re-exported for back-compat: `options-menu.test.ts` imports these helpers
// from this module. Their implementation lives in `Popover.tsx`.
export {
  nextMenuStateOnTriggerClick,
  shouldCloseOnKey,
  shouldCloseOnOutsideClick,
} from './Popover.js';

/* ── pure helpers (load-bearing logic, unit-tested directly) ────────────── */

/**
 * Stage an Advanced-tree `path` → `value` into the parent `pendingEdits`
 * tree. Top-level paths (length 1) are a flat merge; nested paths build the
 * nested structure under the path's first segment so deep edits coexist
 * with curated edits on the same top-level key.
 *
 * Pure, exported for direct unit-testing (the dashboard workspace has no
 * Solid testing-library; load-bearing logic is always factored out for
 * node-env vitest).
 */
export function stagePathEdit(
  pendingEdits: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const top = path[0];
  if (top === undefined) {
    // Defensive: an empty path would mean "stage the whole config"; nothing
    // in the current renderer triggers this, so treat as a no-op.
    return pendingEdits;
  }
  if (path.length === 1) {
    return { ...pendingEdits, [top]: value };
  }
  // Nested: build the {key1: {key2: ...value}} tree, then deep-merge into
  // any existing branch under `top`.
  let nested: unknown = value;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const segment = path[i];
    if (segment === undefined) continue;
    nested = { [segment]: nested };
  }
  const existing = pendingEdits[top];
  const merged =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? mergeStagedConfig(existing, nested as Record<string, unknown>)
      : nested;
  return { ...pendingEdits, [top]: merged };
}

/** Count staged keys — drives the Save button label. */
export function stageCountOf(pendingEdits: Record<string, unknown>): number {
  return Object.keys(pendingEdits).length;
}

/* ── prop contract ──────────────────────────────────────────────────────── */

export interface OptionsMenuProps {
  /** Open/close-controlled by the parent — OptionsMenu does NOT read the store. */
  open: boolean;
  /**
   * Called when the popover requests dismissal (Esc, click-outside). The
   * parent flips its open state false (and returns focus to the trigger).
   */
  onClose: () => void;
  /**
   * Phase 3 mounts the real Commands content here; omitted in Phase 1 → the
   * built-in skeleton placeholder renders.
   */
  commandsSection?: JSX.Element;
  /**
   * Plan 01-02 inlined the Settings + Advanced sections into this component
   * — they read the local `pendingEdits` signal directly, so they can no
   * longer be passed as JSX from `App.tsx`. The prop is accepted-and-ignored
   * for back-compat with `TopBar`, which still forwards a `settingsSection`
   * prop from `App.tsx`'s top-level surface. `App.tsx` stops constructing
   * the JSX in plan 01-02; `TopBar`'s prop pass-through gets cleaned up
   * alongside `ConfigPanel`'s removal in plan 01-03.
   */
  settingsSection?: JSX.Element;
  /**
   * The shared `config` tools-cell from the store — the SAME cell ConfigPanel
   * reads. Drives both the curated Settings rows and the Advanced tree.
   * Optional so plan 01-01's `OptionsMenuProps`-shaped smoke test (which
   * only passes `open` + `onClose`) still type-checks.
   */
  data?: ConfigSnapshot | null;
  /** Mirrors `state.tools.config.loading`. Disables Save while in flight. */
  loading?: boolean;
  /** Mirrors `state.tools.config.error`. Surfaced inline above the action bar. */
  error?: string | null;
  /** ISO-8601 timestamp of the last successful config fetch, or null. */
  lastFetched?: string | null;
  /** Refresh the config cell — the same callback ConfigPanel uses. */
  onRefresh?: () => void;
  /**
   * Save handler. The Options menu builds the merged config (snapshot
   * deep-merged with `pendingEdits`) and hands it to this callback; the
   * parent calls `actions.applyConfigUpdate({ config: merged })`. Returns
   * `{ok: true}` on success — pending edits clear + "Saved ✓" flashes —
   * or `{error}` on failure — pending edits preserved, error renders inline.
   * Optional so the plan 01-01 smoke test still type-checks.
   */
  onSave?: (mergedConfig: unknown) => Promise<{ ok: true } | { error: string }>;
}

/* ── component ──────────────────────────────────────────────────────────── */

export const OptionsMenu: Component<OptionsMenuProps> = (props) => {
  const [pendingEdits, setPendingEdits] = createSignal<Record<string, unknown>>({});
  const [savedFlash, setSavedFlash] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const stageCount = (): number => stageCountOf(pendingEdits());

  const handleStage = (key: string, value: string | boolean): void => {
    setPendingEdits((p) => ({ ...p, [key]: value }));
  };

  const handleDiscardKey = (key: string): void => {
    setPendingEdits((p) => {
      if (!Object.prototype.hasOwnProperty.call(p, key)) return p;
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (k !== key) next[k] = v;
      }
      return next;
    });
  };

  const handleAdvancedChange = (path: readonly string[], value: unknown): void => {
    setPendingEdits((p) => stagePathEdit(p, path, value));
  };

  const handleDiscardAll = (): void => {
    setPendingEdits({});
    setSaveError(null);
  };

  const handleSave = async (): Promise<void> => {
    setSaveError(null);
    if (!props.onSave) return;
    const snapshotConfig = props.data?.config;
    const merged = mergeStagedConfig(snapshotConfig, pendingEdits());
    const result = await props.onSave(merged);
    if ('ok' in result) {
      setPendingEdits({});
      setSavedFlash(true);
      // 2s "Saved ✓" affordance per the plan. The signal flips back
      // automatically; the popover may have closed in the meantime —
      // Solid keeps the timer scoped to the component lifecycle.
      setTimeout(() => setSavedFlash(false), 2000);
    } else {
      setSaveError(result.error);
    }
  };

  return (
    <Popover
      open={props.open}
      onClose={props.onClose}
      role="menu"
      ariaLabel="Options"
      class="options-menu"
    >
      <section class="options-menu-section" data-section="commands">
        <h3 class="options-menu-section-heading">Commands</h3>
        <Show
          when={props.commandsSection}
          fallback={<p class="options-menu-skeleton">Coming soon — Phase 3</p>}
        >
          {props.commandsSection}
        </Show>
      </section>
      <section class="options-menu-section" data-section="settings">
        <h3 class="options-menu-section-heading">Settings</h3>
        <SettingsSection
          data={props.data ?? null}
          loading={props.loading ?? false}
          error={props.error ?? null}
          lastFetched={props.lastFetched ?? null}
          onRefresh={props.onRefresh ?? ((): void => {})}
          pendingEdits={pendingEdits()}
          onStage={handleStage}
          onDiscardKey={handleDiscardKey}
        />
      </section>
      <section class="options-menu-section" data-section="advanced">
        <h3 class="options-menu-section-heading">Advanced</h3>
        <AdvancedConfigSection
          config={props.data?.config}
          pendingEdits={pendingEdits()}
          onChange={handleAdvancedChange}
        />
      </section>
      <section class="options-menu-actions" data-section="actions">
        <Show when={saveError()}>
          {(msg): JSX.Element => <p class="tools-panel-error options-menu-save-error">⚠ {msg()}</p>}
        </Show>
        <Show when={savedFlash()}>
          <p class="options-menu-save-flash" role="status">
            Saved ✓
          </p>
        </Show>
        <div class="options-menu-action-bar">
          <button
            type="button"
            class="options-menu-action options-menu-action-discard"
            aria-label="Discard staged config edits"
            aria-disabled={stageCount() === 0}
            disabled={stageCount() === 0}
            onClick={handleDiscardAll}
          >
            Discard
          </button>
          <button
            type="button"
            class="options-menu-action options-menu-action-save"
            aria-label={
              stageCount() > 0
                ? `Save ${stageCount()} staged config change${stageCount() === 1 ? '' : 's'}`
                : 'Save (no staged changes)'
            }
            aria-disabled={stageCount() === 0 || (props.loading ?? false)}
            disabled={stageCount() === 0 || (props.loading ?? false)}
            onClick={(): void => {
              void handleSave();
            }}
          >
            {stageCount() > 0 ? `Save (${stageCount()} changes)` : 'Save'}
          </button>
        </div>
      </section>
    </Popover>
  );
};
