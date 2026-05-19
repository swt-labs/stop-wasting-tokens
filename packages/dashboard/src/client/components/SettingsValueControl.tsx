/**
 * Phase 02 plan 02-02 — type-dispatched inline editor for a single config
 * field. Rendered inside a `<tr class="settings-control-row">` below the
 * `SettingsTable` row when the user clicks a value cell. The control type
 * (enum segmented buttons / boolean toggle / number input / array
 * comma-input / union / string input) is inferred from membership in the
 * shared maps in `config-enum-vocab.ts` plus a hardcoded branch for
 * `max_uat_remediation_rounds` (the lone union field: `number | false`,
 * where `false` means unlimited).
 *
 * Load-bearing logic — `inferControlType` + `isUnlimitedRounds` — is
 * exported as pure helpers and unit-tested directly via
 * `settings-table.test.ts`. Same pattern as `SettingsSection.tsx` (the
 * dashboard workspace has no `@solidjs/testing-library`; node-env vitest
 * with no DOM is the rule). Cf. PATTERNS.md §"Pure-helper + node-env vitest
 * test pattern".
 *
 * Phase 03 will mount this component (and `SettingsTable`) inside the
 * renamed Settings ▼ dropdown; Phase 02 ships it standalone.
 */

import { For, Show } from 'solid-js';

import {
  CONFIG_ENUM_OPTIONS,
  SETTINGS_ARRAY_FIELDS,
  SETTINGS_BOOLEAN_FIELDS,
  SETTINGS_NUMBER_FIELDS,
} from './config-enum-vocab.js';

/* ── pure helpers (load-bearing logic, unit-tested directly) ────────────── */

export type ControlType = 'enum' | 'boolean' | 'number' | 'array' | 'union' | 'string';

/**
 * Dispatch a config field to the right control type. Order matters: enum
 * check first, then boolean, number, array, the `max_uat_remediation_rounds`
 * union branch, fallback to string. Exported for direct unit-testing.
 */
export function inferControlType(key: string): ControlType {
  if (CONFIG_ENUM_OPTIONS[key]) return 'enum';
  if (SETTINGS_BOOLEAN_FIELDS.includes(key)) return 'boolean';
  if (SETTINGS_NUMBER_FIELDS.includes(key)) return 'number';
  if (SETTINGS_ARRAY_FIELDS.includes(key)) return 'array';
  if (key === 'max_uat_remediation_rounds') return 'union';
  return 'string';
}

/**
 * `max_uat_remediation_rounds` semantics: `false` means unlimited; any
 * positive integer is a per-cycle ceiling. Exported for direct unit-testing.
 */
export function isUnlimitedRounds(v: unknown): boolean {
  return v === false;
}

/* ── prop contract ──────────────────────────────────────────────────────── */

export interface SettingsValueControlProps {
  configKey: string;
  current: unknown;
  onChange: (value: unknown) => void;
  onDiscard?: () => void;
  onClose: () => void;
}

/* ── component ──────────────────────────────────────────────────────────── */

export function SettingsValueControl(props: SettingsValueControlProps) {
  const type = () => inferControlType(props.configKey);

  return (
    <div
      class="settings-control"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <Show when={type() === 'enum'}>
        <For each={CONFIG_ENUM_OPTIONS[props.configKey] ?? []}>
          {(option) => (
            <button
              type="button"
              class="settings-segment"
              classList={{ 'settings-segment-active': props.current === option }}
              onClick={() => {
                if (props.current !== option) props.onChange(option);
              }}
            >
              {option}
            </button>
          )}
        </For>
      </Show>

      <Show when={type() === 'boolean'}>
        <button
          type="button"
          class="settings-segment"
          classList={{ 'settings-segment-active': props.current === true }}
          onClick={() => props.onChange(true)}
        >
          on
        </button>
        <button
          type="button"
          class="settings-segment"
          classList={{ 'settings-segment-active': props.current === false }}
          onClick={() => props.onChange(false)}
        >
          off
        </button>
      </Show>

      <Show when={type() === 'number'}>
        <input
          type="number"
          min="1"
          step="1"
          value={typeof props.current === 'number' ? String(props.current) : ''}
          onInput={(e) => {
            const n = Number(e.currentTarget.value);
            if (Number.isFinite(n) && n > 0) props.onChange(Math.floor(n));
          }}
        />
      </Show>

      <Show when={type() === 'array'}>
        {/* Minimal v1: comma-separated text input. Phase 03 may upgrade to chips. */}
        <input
          type="text"
          value={Array.isArray(props.current) ? props.current.join(', ') : ''}
          onInput={(e) => {
            const arr = e.currentTarget.value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            props.onChange(arr);
          }}
        />
      </Show>

      <Show when={type() === 'union'}>
        {/* max_uat_remediation_rounds — union of `number | false` where false = unlimited. */}
        <button
          type="button"
          class="settings-segment"
          classList={{ 'settings-segment-active': isUnlimitedRounds(props.current) }}
          onClick={() => props.onChange(false)}
        >
          unlimited
        </button>
        <Show when={!isUnlimitedRounds(props.current)}>
          <input
            type="number"
            min="1"
            step="1"
            value={typeof props.current === 'number' ? String(props.current) : '1'}
            onInput={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isFinite(n) && n > 0) props.onChange(Math.floor(n));
            }}
          />
        </Show>
        <button type="button" class="settings-segment" onClick={() => props.onChange(1)}>
          set limit
        </button>
      </Show>

      <Show when={type() === 'string'}>
        <input
          type="text"
          value={typeof props.current === 'string' ? props.current : ''}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      </Show>

      <Show when={typeof props.onDiscard === 'function'}>
        <button type="button" onClick={() => props.onDiscard?.()}>
          discard
        </button>
      </Show>
    </div>
  );
}
