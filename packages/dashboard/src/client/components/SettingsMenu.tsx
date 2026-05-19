/**
 * Phase 03 plan 03-01 (Settings Dropdown v2) — the Settings dropdown now hosts
 * Commands + a SINGLE Settings section (24 rows via SettingsTable, with a
 * profile selector in the header) + a sticky action bar inline. The popover's
 * `Settings ▾` trigger remains the only collapse layer; once open, every
 * section body is visible at once. This replaces the previous milestone-14
 * curated SettingsSection + Advanced tree pair with one composed surface.
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
 *     they were never saved. (Milestone-14 batched-staged-edit model
 *     PRESERVED through the Phase 03 rewrite.)
 *
 *   - **Single Settings section.** Phase 03 retired the curated/Advanced
 *     split — `SettingsTable` renders the full 24-key surface (one row
 *     per `SETTINGS_DISPLAY_ORDER` entry) and the ProfileDropdown stages
 *     all values from a builtin profile in one click. App.tsx still
 *     passes the config snapshot + the Save handler.
 *
 *   - **`commandsSection` stays a JSX slot.** Commands has no edit-state
 *     contract with the Settings menu; the existing slot keeps `App.tsx`'s
 *     CommandsSection wiring intact.
 *
 *   - **Store-key vocabulary preserved.** TopBar prop names
 *     (`optionsMenuOpen`, `onToggleOptionsMenu`, `onCloseOptionsMenu`)
 *     and the dashboard-store keys keep their `optionsMenu*` names —
 *     they describe an internal popover slot, not a user-facing label.
 *     Phase 03 changes the user-visible trigger text only.
 *
 * The load-bearing pure helpers (`nextMenuStateOnTriggerClick`,
 * `shouldCloseOnKey`, `shouldCloseOnOutsideClick`) live in `Popover.tsx`;
 * they are RE-EXPORTED here unchanged so existing `settings-menu.test.ts`
 * imports keep resolving.
 */

import { BUILTIN_PROFILES, PROFILE_IDS, type ProfileId } from '@swt-labs/core';
import type { ConfigSnapshot } from '@swt-labs/shared';
import { Show, createSignal, type Component, type JSX } from 'solid-js';

import { Popover } from './Popover.js';
import { ProfileDropdown, stageProfileValues } from './ProfileDropdown.js';
import { SettingsTable } from './SettingsTable.jsx';

// Re-exported for back-compat: `settings-menu.test.ts` imports these helpers
// from this module. Their implementation lives in `Popover.tsx`.
export {
  nextMenuStateOnTriggerClick,
  shouldCloseOnKey,
  shouldCloseOnOutsideClick,
} from './Popover.js';

/* ── pure helpers (load-bearing logic, unit-tested directly) ────────────── */

/**
 * Deep-merge `pending` into `current` and return a fresh object. Used by
 * `SettingsMenu`'s Save handler to build the merged payload posted to
 * `applyConfigUpdate({ config: merged })`.
 *
 * THE merge MUST preserve every non-target field in `current` — a single-key
 * partial would be a data-loss bug. `parseConfig` (ConfigSchema.safeParse,
 * every key `.default()`/`.optional()`) ACCEPTS `{ effort: 'fast' }` and
 * returns a full config with every OTHER field reset to its default +
 * `marketplace`/`hooks` dropped, and the /api/config route writes the
 * validated object directly with no merge. So the caller passes the live
 * config cell as `current` and this helper produces a fresh merged object —
 * `current` is never mutated. This is the single tested merge point.
 *
 * Plain objects merge recursively; arrays + primitives are replaced
 * wholesale (matches the staged-edit semantics — a user editing an array
 * field replaces it). Non-object `current` is treated as `{}` so the
 * greenfield / no-data case still returns the pending payload.
 *
 * Phase 03 plan 03-01 re-homed this helper from SettingsSection.tsx into
 * SettingsMenu.tsx so SettingsSection.tsx can be deleted without breaking
 * handleSave at typecheck.
 */
export function mergeStagedConfig(
  current: unknown,
  pending: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = { ...base };
  for (const [key, pendingValue] of Object.entries(pending)) {
    const baseValue = out[key];
    if (
      typeof pendingValue === 'object' &&
      pendingValue !== null &&
      !Array.isArray(pendingValue) &&
      typeof baseValue === 'object' &&
      baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      out[key] = mergeStagedConfig(baseValue, pendingValue as Record<string, unknown>);
    } else {
      out[key] = pendingValue;
    }
  }
  return out;
}

/** Count staged keys — drives the Save button label. */
export function stageCountOf(pendingEdits: Record<string, unknown>): number {
  return Object.keys(pendingEdits).length;
}

/* ── prop contract ──────────────────────────────────────────────────────── */

export interface SettingsMenuProps {
  /** Open/close-controlled by the parent — SettingsMenu does NOT read the store. */
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
   * used to read. Drives the SettingsTable rows + the profile selector.
   * Optional so plan 01-01's `OptionsMenuProps`-shaped smoke test (now
   * `SettingsMenuProps`-shaped) that only passes `open` + `onClose` still
   * type-checks.
   */
  data?: ConfigSnapshot | null;
  /** Mirrors `state.tools.config.loading`. Disables Save while in flight. */
  loading?: boolean;
  /** Mirrors `state.tools.config.error`. Surfaced inline above the action bar. */
  error?: string | null;
  /** ISO-8601 timestamp of the last successful config fetch, or null. */
  lastFetched?: string | null;
  /** Refresh the config cell — the same callback ConfigPanel used. */
  onRefresh?: () => void;
  /**
   * Save handler. The Settings menu builds the merged config (snapshot
   * deep-merged with `pendingEdits`) and hands it to this callback; the
   * parent calls `actions.applyConfigUpdate({ config: merged })`. Returns
   * `{ok: true}` on success — pending edits clear + "Saved ✓" flashes —
   * or `{error}` on failure — pending edits preserved, error renders inline.
   * Optional so the plan 01-01 smoke test still type-checks.
   */
  onSave?: (mergedConfig: unknown) => Promise<{ ok: true } | { error: string }>;
}

/* ── component ──────────────────────────────────────────────────────────── */

export const SettingsMenu: Component<SettingsMenuProps> = (props) => {
  const [pendingEdits, setPendingEdits] = createSignal<Record<string, unknown>>({});
  const [savedFlash, setSavedFlash] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const stageCount = (): number => stageCountOf(pendingEdits());

  // Widened from `(key, value: string | boolean)` → `(key, value: unknown)`
  // per Phase 03 plan 03-01 drift-lock 7: SettingsTable.onStage's prop type
  // is `(key, value: unknown)` because the new surface handles numbers,
  // arrays, and the `false` sentinel for `max_uat_remediation_rounds`.
  // setPendingEdits is type-agnostic — zero runtime impact.
  const handleStage = (key: string, value: unknown): void => {
    setPendingEdits((p) => ({ ...p, [key]: value }));
  };

  const handleProfileSelect = (id: ProfileId): void => {
    setPendingEdits((p) => stageProfileValues(id, BUILTIN_PROFILES[id].values, p));
  };

  /**
   * Resolve the active profile id for the ProfileDropdown header — pending
   * edits win for immediate visual feedback (Scout §4 Option B). Fallback
   * chain: staged.active_profile → config.active_profile → 'default'. The
   * PROFILE_IDS guard handles any legacy config where active_profile is not
   * a recognised builtin id.
   */
  const activeProfileId = (): ProfileId => {
    const staged = pendingEdits().active_profile;
    const fromConfig = (props.data?.config as Record<string, unknown> | undefined)?.active_profile;
    const value = staged ?? fromConfig ?? 'default';
    return (PROFILE_IDS as readonly string[]).includes(value as string)
      ? (value as ProfileId)
      : 'default';
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
      ariaLabel="Settings"
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
        <div class="settings-menu-header">
          <h3 class="options-menu-section-heading">SETTINGS</h3>
          <ProfileDropdown
            current={activeProfileId()}
            hasPendingEdits={stageCount() > 0}
            onSelect={handleProfileSelect}
          />
        </div>
        <SettingsTable
          config={(props.data?.config as Record<string, unknown>) ?? {}}
          pendingEdits={pendingEdits()}
          onStage={handleStage}
          onDiscardKey={handleDiscardKey}
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
