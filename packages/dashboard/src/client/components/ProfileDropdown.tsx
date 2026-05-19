/**
 * Plan 02-03 — `ProfileDropdown`: a native `<select>` over `PROFILE_IDS`
 * rendering `BUILTIN_PROFILES[id].name` labels, with an inline
 * confirmation gate that intercepts profile switches when there are
 * unsaved manual edits.
 *
 * Locked Decisions (from Phase 02 .context-lead.md / brief):
 *  - #14 — native `<select>` element (NO custom popover, NO Solid
 *    `<Popover>` primitive). The native element handles keyboard nav
 *    for free.
 *  - #6 — no silent fallbacks: replacing a user's careful manual edits
 *    with a profile preset is data-loss-by-design unless explicitly
 *    confirmed. The inline confirm row is that explicit gate.
 *  - #5 — confirmation surfaces inline (NOT `window.confirm()`, NOT a
 *    `ConfirmDialog` component). Matches the dashboard's no-modal idiom.
 *
 * Type narrowing seam (Phase 01 lock): `props.current` is typed as
 * `ProfileId` (the strict 4-id union). The `ConfigSchema` field
 * `active_profile` is open string `z.string()` — this dropdown only
 * emits the 4 builtin IDs. Open-string schema + strict-union UI prop is
 * the intended boundary.
 *
 * CSS ownership: this file does NOT import / write styles. Plan 02-02
 * (parallel wave-2 sibling) owns ALL `.profile-dropdown*` selectors.
 * This component only references those classes via the global stylesheet.
 *
 * Mount surface: this component ships STANDALONE in Phase 02 — it is
 * NOT yet wired into `OptionsMenu.tsx`. Phase 03 owns the integration.
 */

import { BUILTIN_PROFILES, PROFILE_IDS, type ProfileId } from '@swt-labs/core';
import { For, Show, createSignal } from 'solid-js';

/**
 * True when switching from `currentId` to `nextId` should trigger the
 * unsaved-changes confirmation gate.
 *
 * Truth-table:
 *   nextId === currentId          → false (identity switch never confirms)
 *   hasPendingEdits === false     → false (no pending → no data loss)
 *   nextId !== currentId && pend  → true  (real switch with pending edits)
 *
 * Exported for direct unit-testing.
 */
export function shouldConfirmSwitch(
  currentId: ProfileId,
  nextId: ProfileId,
  hasPendingEdits: boolean,
): boolean {
  return nextId !== currentId && hasPendingEdits;
}

/**
 * Build the next `pendingEdits` object after a profile is selected.
 * Merges `profileValues` into `pendingEdits`, then sets
 * `active_profile = profileId` LAST so the explicit assignment always
 * wins regardless of profile content.
 *
 *  - PURE: never mutates the input `pendingEdits` or `profileValues`.
 *  - Defense-in-depth: Plan 02-01 forbids `active_profile` from
 *    appearing in any builtin profile's `values`, but the spread-then-
 *    explicit-set order guarantees correctness even if a future
 *    contributor breaks that invariant.
 *
 * Consumed by the Phase 03 `handleProfileSelect` handler inside the
 * SettingsMenu parent (`setPendingEdits(stageProfileValues(...))`).
 * Exported for direct unit-testing.
 */
export function stageProfileValues(
  profileId: ProfileId,
  profileValues: Readonly<Record<string, unknown>>,
  pendingEdits: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...pendingEdits };
  for (const [key, value] of Object.entries(profileValues)) {
    next[key] = value;
  }
  next.active_profile = profileId;
  return next;
}

export interface ProfileDropdownProps {
  current: ProfileId;
  hasPendingEdits: boolean;
  onSelect: (id: ProfileId) => void;
}

export function ProfileDropdown(props: ProfileDropdownProps) {
  const [confirming, setConfirming] = createSignal<ProfileId | null>(null);

  const handleChange = (raw: string) => {
    // Narrow the raw <select> value to ProfileId. PROFILE_IDS is the
    // only set of values rendered, so this is safe at runtime.
    if (!(PROFILE_IDS as readonly string[]).includes(raw)) return;
    const id = raw as ProfileId;
    if (!shouldConfirmSwitch(props.current, id, props.hasPendingEdits)) {
      // Identity switch or no pending edits — apply immediately.
      if (id !== props.current) props.onSelect(id);
      return;
    }
    setConfirming(id);
  };

  return (
    <div class="profile-dropdown-wrap">
      <select
        class="profile-dropdown"
        value={props.current}
        onChange={(e) => handleChange(e.currentTarget.value)}
      >
        <For each={PROFILE_IDS}>
          {(id) => <option value={id}>{BUILTIN_PROFILES[id].name}</option>}
        </For>
      </select>
      <Show when={confirming() !== null}>
        {(_) => {
          // `confirming()` is non-null inside this branch — the Show's
          // `when={confirming() !== null}` gates it. We re-read the
          // signal here rather than relying on the Show's accessor
          // (which is typed as the truthy `boolean`, not `ProfileId`).
          const pendingId = confirming() as ProfileId;
          return (
            <div class="profile-dropdown__confirm" role="alertdialog">
              <span>Replace unsaved changes with {BUILTIN_PROFILES[pendingId].name} preset?</span>
              <button
                type="button"
                onClick={() => {
                  props.onSelect(pendingId);
                  setConfirming(null);
                }}
              >
                Yes
              </button>
              <button type="button" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
