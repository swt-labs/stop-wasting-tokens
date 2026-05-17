/**
 * Plan 02-01 T5 — `<SettingsSection>` coverage.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see
 * `provider-auth-panel.test.ts` / `project-state-panel.test.ts` /
 * `options-menu.test.ts` for the same constraint). To keep this plan's
 * test deliverable shippable without a workspace dep bump, the section's
 * load-bearing behaviour is factored into PURE exported helpers —
 * `currentSettingValue`, `isSegmentActive`, `buildConfigPatch`,
 * `nextBooleanValue`, `isFieldBusy` — which are unit-tested directly here,
 * plus a smoke test that the `SettingsSection` export is a callable Solid
 * component and a shared-vocab single-source consistency guard.
 *
 * Test group (1) — `buildConfigPatch` — is THE regression guard against
 * the confirmed data-loss bug: a single-key partial patch
 * (`{ config: { [key]: value } }`) would be ACCEPTED by `parseConfig`
 * (ConfigSchema.safeParse, every top-level key `.default()`/`.optional()`)
 * and returned as a full config with every NON-target field reset to its
 * default + `marketplace`/`hooks` dropped, which the /api/config route
 * then writes directly with no merge. `buildConfigPatch` MUST therefore
 * produce a FULL-config merge — every non-target key preserved — and MUST
 * NOT mutate the caller's `base` config cell.
 */

import { describe, expect, it } from 'vitest';

import {
  CONFIG_ENUM_OPTIONS,
  SETTINGS_BOOLEAN_FIELDS,
  SETTINGS_FIELD_ORDER,
} from '../src/client/components/config-enum-vocab.js';
import {
  SettingsSection,
  buildConfigPatch,
  currentSettingValue,
  isFieldBusy,
  isSegmentActive,
  nextBooleanValue,
  type SettingsSectionProps,
} from '../src/client/components/SettingsSection.jsx';

/* (1) THE regression guard against the data-loss bug — full-config merge,
 * non-target-key preservation, no mutation of the caller's config cell. */
describe('buildConfigPatch — full-config merge', () => {
  it('overrides the target field AND preserves every non-target field', () => {
    expect(
      buildConfigPatch({ effort: 'balanced', autonomy: 'standard' }, 'effort', 'fast'),
    ).toEqual({ config: { effort: 'fast', autonomy: 'standard' } });
  });

  it('merges a boolean field while preserving the rest', () => {
    expect(buildConfigPatch({ auto_uat: false, effort: 'turbo' }, 'auto_uat', true)).toEqual({
      config: { auto_uat: true, effort: 'turbo' },
    });
  });

  it('handles an empty base — the greenfield / no-data case', () => {
    expect(buildConfigPatch({}, 'effort', 'fast')).toEqual({ config: { effort: 'fast' } });
  });

  it('does NOT mutate the caller-provided base config cell', () => {
    const base = { effort: 'balanced', autonomy: 'standard' };
    const snapshot = { ...base };
    buildConfigPatch(base, 'effort', 'fast');
    expect(base).toEqual(snapshot);
  });
});

/* (2) isSegmentActive — current-value highlight, defensive on bad input. */
describe('isSegmentActive', () => {
  it('is true for the currently-set value', () => {
    expect(isSegmentActive({ effort: 'balanced' }, 'effort', 'balanced')).toBe(true);
  });

  it('is false for a non-current value', () => {
    expect(isSegmentActive({ effort: 'balanced' }, 'effort', 'fast')).toBe(false);
  });

  it('is false when config is null', () => {
    expect(isSegmentActive(null, 'effort', 'fast')).toBe(false);
  });

  it('is false when the key is absent from config', () => {
    expect(isSegmentActive({}, 'effort', 'fast')).toBe(false);
  });
});

/* (3) currentSettingValue — defensive config[key] read. */
describe('currentSettingValue', () => {
  it('reads a boolean value', () => {
    expect(currentSettingValue({ auto_uat: true }, 'auto_uat')).toBe(true);
  });

  it('reads a string value', () => {
    expect(currentSettingValue({ effort: 'fast' }, 'effort')).toBe('fast');
  });

  it('is undefined for an absent key', () => {
    expect(currentSettingValue({}, 'effort')).toBeUndefined();
  });

  it('is undefined when config is null', () => {
    expect(currentSettingValue(null, 'effort')).toBeUndefined();
  });
});

/* (4) nextBooleanValue — the auto_uat toggle helper. */
describe('nextBooleanValue', () => {
  it('toggles true → false', () => {
    expect(nextBooleanValue(true)).toBe(false);
  });

  it('toggles false → true', () => {
    expect(nextBooleanValue(false)).toBe(true);
  });

  it('treats undefined as falsy → true', () => {
    expect(nextBooleanValue(undefined)).toBe(true);
  });
});

/* (5) isFieldBusy — the in-flight field-key gate. */
describe('isFieldBusy', () => {
  it('is true when the pending field matches the key', () => {
    expect(isFieldBusy('effort', 'effort')).toBe(true);
  });

  it('is false when the pending field is a different key', () => {
    expect(isFieldBusy('effort', 'autonomy')).toBe(false);
  });

  it('is false when no field is pending', () => {
    expect(isFieldBusy(null, 'effort')).toBe(false);
  });
});

/* (6) shared enum vocabulary — single source (research R3 / SC "no second
 * copy that can drift"). The Settings section's vocabulary is sourced
 * entirely from the shared mirror — the same CONFIG_ENUM_OPTIONS object
 * ConfigPanel imports. */
describe('shared enum vocabulary — single source', () => {
  it('every SETTINGS_FIELD_ORDER key resolves to a non-empty CONFIG_ENUM_OPTIONS list', () => {
    for (const key of SETTINGS_FIELD_ORDER) {
      const options = CONFIG_ENUM_OPTIONS[key];
      expect(Array.isArray(options)).toBe(true);
      expect((options ?? []).length).toBeGreaterThan(0);
    }
  });

  it('SETTINGS_FIELD_ORDER includes backend (plan 01-01 — curated knob)', () => {
    expect(SETTINGS_FIELD_ORDER).toContain('backend');
  });

  it('worktree_isolation is present in CONFIG_ENUM_OPTIONS with the expected vocabulary', () => {
    expect(CONFIG_ENUM_OPTIONS.worktree_isolation).toEqual(['off', 'on', 'auto']);
  });

  it('SETTINGS_BOOLEAN_FIELDS is exactly [auto_uat]', () => {
    expect(SETTINGS_BOOLEAN_FIELDS).toEqual(['auto_uat']);
  });
});

/* (7) component smoke + prop-shape assertion. */
describe('SettingsSection component', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof SettingsSection).toBe('function');
  });

  it('has the ConfigPanel-shaped controlled prop contract', () => {
    const props: SettingsSectionProps = {
      data: null,
      loading: false,
      error: null,
      lastFetched: null,
      onRefresh: () => {},
      onApply: async () => ({ ok: true }),
    };
    expect(props.loading).toBe(false);
  });
});
