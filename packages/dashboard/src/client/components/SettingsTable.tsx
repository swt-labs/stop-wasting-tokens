/**
 * Phase 02 plan 02-02 — the 24-row 3-column flat table that supersedes the
 * milestone-14 `SettingsSection` segmented-control surface. Each row shows
 * a config key + its current/staged value + a one-line description; clicking
 * the value cell toggles an inline `<SettingsValueControl>` row beneath it
 * (Brief Locked Decision #8 — inline expand-in-place, not a separate panel).
 *
 * Pure helpers — `formatValue`, `currentValueFor`, `isModified` — are
 * exported and unit-tested via `settings-table.test.ts`. Component JSX
 * itself stays untested (no @solidjs/testing-library in the workspace);
 * Phase 03 will mount this inside the renamed Settings ▼ dropdown for the
 * first integration site.
 *
 * Display rows + descriptions live in `setting-descriptions.ts`. The
 * `SETTING_DESCRIPTIONS` map and `SETTINGS_DISPLAY_ORDER` array are guarded
 * one-to-one by a regression test so adding a new field forces both
 * structures in lockstep.
 */

import { createSignal, For, Show } from 'solid-js';

import { SETTING_DESCRIPTIONS, SETTINGS_DISPLAY_ORDER } from './setting-descriptions.js';
import { SettingsValueControl } from './SettingsValueControl.jsx';

/* ── pure helpers (load-bearing logic, unit-tested directly) ────────────── */

/**
 * Render a config value as a string for the Value column.
 *  - arrays render as comma-joined; empty array renders as `(none)`
 *  - booleans render as `on` / `off`
 *  - `null` / `undefined` render as the empty string
 *  - everything else falls through `String(v)`
 *
 * The `max_uat_remediation_rounds` `false` sentinel renders as `off`
 * here — the control's inline view handles the `unlimited` label.
 * Exported for direct unit-testing.
 */
export function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.length === 0 ? '(none)' : v.join(', ');
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

/**
 * Resolve the effective value for `key` — `pendingEdits` overrides take
 * precedence over the live config snapshot. Mirrors
 * `SettingsSection.resolveDisplayValue` but with `Record<string, unknown>`
 * instead of `ConfigSnapshot`. Exported for direct unit-testing.
 */
export function currentValueFor(
  key: string,
  config: Record<string, unknown>,
  pendingEdits: Record<string, unknown>,
): unknown {
  if (Object.prototype.hasOwnProperty.call(pendingEdits, key)) {
    return pendingEdits[key];
  }
  return config[key];
}

/**
 * True when `pendingEdits` has an own property for `key` — drives the
 * `is-modified` row class + the green-dot marker. Exported for direct
 * unit-testing.
 */
export function isModified(key: string, pendingEdits: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(pendingEdits, key);
}

/* ── prop contract ──────────────────────────────────────────────────────── */

export interface SettingsTableProps {
  config: Record<string, unknown>;
  pendingEdits: Record<string, unknown>;
  onStage: (key: string, value: unknown) => void;
  onDiscardKey: (key: string) => void;
}

/* ── component ──────────────────────────────────────────────────────────── */

export function SettingsTable(props: SettingsTableProps) {
  const [openKey, setOpenKey] = createSignal<string | null>(null);

  const toggleOpen = (key: string) => {
    setOpenKey((curr) => (curr === key ? null : key));
  };

  return (
    <table class="settings-table">
      <thead>
        <tr>
          <th>setting</th>
          <th>value</th>
          <th>description</th>
        </tr>
      </thead>
      <tbody>
        <For each={SETTINGS_DISPLAY_ORDER}>
          {(key) => (
            <>
              <tr
                class="settings-table-row"
                classList={{
                  'is-modified': isModified(key, props.pendingEdits),
                  'is-open': openKey() === key,
                }}
                data-modified={isModified(key, props.pendingEdits) ? 'true' : undefined}
              >
                <td class="settings-key">{key}</td>
                <td class="settings-value">
                  <button type="button" class="settings-value-btn" onClick={() => toggleOpen(key)}>
                    {formatValue(currentValueFor(key, props.config, props.pendingEdits))}
                    <Show when={isModified(key, props.pendingEdits)}>
                      <span class="settings-modified-dot" aria-label="modified" />
                    </Show>
                  </button>
                </td>
                <td class="settings-description">{SETTING_DESCRIPTIONS[key] ?? ''}</td>
              </tr>
              <Show when={openKey() === key}>
                <tr class="settings-control-row">
                  <td colspan="3">
                    <SettingsValueControl
                      configKey={key}
                      current={currentValueFor(key, props.config, props.pendingEdits)}
                      onChange={(value) => props.onStage(key, value)}
                      onDiscard={
                        isModified(key, props.pendingEdits)
                          ? () => props.onDiscardKey(key)
                          : undefined
                      }
                      onClose={() => setOpenKey(null)}
                    />
                  </td>
                </tr>
              </Show>
            </>
          )}
        </For>
      </tbody>
    </table>
  );
}
