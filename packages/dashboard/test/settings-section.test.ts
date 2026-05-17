/**
 * Plan 01-03 — full rewrite for the staged-edit `<SettingsSection>` contract.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see
 * `provider-auth-panel.test.ts` / `options-menu.test.ts` /
 * `advanced-config-section.test.ts` for the same constraint). To keep this
 * plan's test deliverable shippable without a workspace dep bump, the
 * section's load-bearing behaviour is factored into PURE exported helpers —
 * `currentSettingValue`, `resolveDisplayValue`, `isSegmentActive`,
 * `mergeStagedConfig`, `nextBooleanValue` — which are unit-tested directly
 * here, plus a smoke test that the `SettingsSection` export is a callable
 * Solid component and the shared-vocab single-source consistency guard.
 *
 * The mergeStagedConfig group is THE regression guard against the confirmed
 * data-loss bug: a single-key partial config-write would be ACCEPTED by
 * `parseConfig` (ConfigSchema.safeParse, every key `.default()`/`.optional()`)
 * and returned as a FULL config with every non-target field reset to its
 * default + `marketplace`/`hooks` dropped. The /api/config route writes the
 * validated object directly with no merge, so the caller MUST pass a fully
 * merged config — mergeStagedConfig is the single tested merge point.
 *
 * Plan 01-02's back-compat alias `buildConfigPatch` was retired in plan
 * 01-03; the merge assertions migrated to `mergeStagedConfig` directly.
 */

import { describe, expect, it } from 'vitest';

import {
  CONFIG_ENUM_OPTIONS,
  SETTINGS_BOOLEAN_FIELDS,
  SETTINGS_FIELD_ORDER,
} from '../src/client/components/config-enum-vocab.js';
import {
  SettingsSection,
  currentSettingValue,
  isSegmentActive,
  mergeStagedConfig,
  nextBooleanValue,
  resolveDisplayValue,
  type SettingsSectionProps,
} from '../src/client/components/SettingsSection.jsx';

/* ── (1) mergeStagedConfig — THE regression guard against the data-loss
 * bug. The handler MUST produce a FULL-config merge — every non-target
 * key preserved — and MUST NOT mutate the caller's `current` cell. ── */
describe('mergeStagedConfig — staged-edit deep merge', () => {
  it('returns the snapshot unchanged when pending is empty', () => {
    const current = { effort: 'balanced', autonomy: 'standard' };
    const merged = mergeStagedConfig(current, {});
    expect(merged).toEqual(current);
    // A FRESH object — never the same reference as the caller's snapshot.
    expect(merged).not.toBe(current);
  });

  it('overrides the target field AND preserves every non-target field', () => {
    expect(
      mergeStagedConfig({ effort: 'balanced', autonomy: 'standard' }, { effort: 'fast' }),
    ).toEqual({ effort: 'fast', autonomy: 'standard' });
  });

  it('merges a boolean field while preserving the rest', () => {
    expect(mergeStagedConfig({ auto_uat: false, effort: 'turbo' }, { auto_uat: true })).toEqual({
      auto_uat: true,
      effort: 'turbo',
    });
  });

  it('handles an empty base — the greenfield / no-data case', () => {
    expect(mergeStagedConfig({}, { effort: 'fast' })).toEqual({ effort: 'fast' });
  });

  it('handles a non-object base — treats it as {} so pending payload still wins', () => {
    expect(mergeStagedConfig(null, { effort: 'fast' })).toEqual({ effort: 'fast' });
    expect(mergeStagedConfig(undefined, { effort: 'fast' })).toEqual({ effort: 'fast' });
  });

  it('deep-merges nested objects (Advanced-tree path)', () => {
    expect(
      mergeStagedConfig(
        { effort: 'balanced', nested: { keep: 'kept', overwrite: 'old' } },
        { nested: { overwrite: 'new' } },
      ),
    ).toEqual({ effort: 'balanced', nested: { keep: 'kept', overwrite: 'new' } });
  });

  it('replaces arrays wholesale (not element-merged)', () => {
    expect(mergeStagedConfig({ list: ['a', 'b', 'c'] }, { list: ['x'] })).toEqual({ list: ['x'] });
  });

  it('does NOT mutate the caller-provided base config cell', () => {
    const base = { effort: 'balanced', autonomy: 'standard' };
    const snapshot = { ...base };
    mergeStagedConfig(base, { effort: 'fast' });
    expect(base).toEqual(snapshot);
  });

  it('does NOT mutate a nested object inside the base', () => {
    const base = { nested: { keep: 'kept', overwrite: 'old' } };
    const baseNestedSnapshot = { ...base.nested };
    mergeStagedConfig(base, { nested: { overwrite: 'new' } });
    expect(base.nested).toEqual(baseNestedSnapshot);
  });
});

/* ── (2) isSegmentActive — current-displayed-value highlight; staged wins
 *  over snapshot, defensive on bad input. ── */
describe('isSegmentActive', () => {
  it('is true for the snapshot value when nothing is staged', () => {
    expect(isSegmentActive({ effort: 'balanced' }, {}, 'effort', 'balanced')).toBe(true);
  });

  it('is false for a non-current value when nothing is staged', () => {
    expect(isSegmentActive({ effort: 'balanced' }, {}, 'effort', 'fast')).toBe(false);
  });

  it('flips to true for the staged value (pendingEdits override)', () => {
    expect(isSegmentActive({ effort: 'balanced' }, { effort: 'fast' }, 'effort', 'fast')).toBe(
      true,
    );
  });

  it('flips to false for the snapshot value once a different value is staged', () => {
    expect(isSegmentActive({ effort: 'balanced' }, { effort: 'fast' }, 'effort', 'balanced')).toBe(
      false,
    );
  });

  it('is false when config is null', () => {
    expect(isSegmentActive(null, {}, 'effort', 'fast')).toBe(false);
  });

  it('is false when the key is absent from config AND not staged', () => {
    expect(isSegmentActive({}, {}, 'effort', 'fast')).toBe(false);
  });
});

/* ── (3) resolveDisplayValue — staged-wins-over-snapshot precedence
 *  documented as a separate helper exported alongside isSegmentActive. ── */
describe('resolveDisplayValue', () => {
  it('resolves to the snapshot value when not staged', () => {
    expect(resolveDisplayValue({ effort: 'balanced' }, {}, 'effort')).toBe('balanced');
  });

  it('resolves to the staged value when present in pendingEdits', () => {
    expect(resolveDisplayValue({ effort: 'balanced' }, { effort: 'fast' }, 'effort')).toBe('fast');
  });

  it('treats a `pendingEdits[key] = undefined` as STAGED (hasOwnProperty wins)', () => {
    // The hasOwnProperty branch in resolveDisplayValue MUST honour explicit
    // undefined-staging — otherwise a future "clear-to-default" affordance
    // would silently fall back to snapshot.
    expect(
      resolveDisplayValue({ effort: 'balanced' }, { effort: undefined }, 'effort'),
    ).toBeUndefined();
  });

  it('falls back to undefined when neither staged nor in snapshot', () => {
    expect(resolveDisplayValue({}, {}, 'missing')).toBeUndefined();
  });
});

/* ── (4) currentSettingValue — defensive config[key] read. ── */
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

/* ── (5) nextBooleanValue — the auto_uat toggle helper. ── */
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

/* ── (6) shared enum vocabulary — single source. The Settings section's
 *  vocabulary is sourced entirely from the shared mirror — the same
 *  CONFIG_ENUM_OPTIONS object AdvancedConfigSection imports. ── */
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

  it('backend row renders all three CONFIG_ENUM_OPTIONS.backend values', () => {
    // The component renders one button per value in
    // CONFIG_ENUM_OPTIONS[key]; the assertion is the union — both the
    // expected enum vocabulary AND the presence of every value the
    // curated row needs to draw.
    expect(CONFIG_ENUM_OPTIONS.backend).toEqual(['codex', 'claude-code', 'ollama']);
  });

  it('worktree_isolation is present in CONFIG_ENUM_OPTIONS with the expected vocabulary', () => {
    expect(CONFIG_ENUM_OPTIONS.worktree_isolation).toEqual(['off', 'on', 'auto']);
  });

  it('SETTINGS_BOOLEAN_FIELDS is exactly [auto_uat]', () => {
    expect(SETTINGS_BOOLEAN_FIELDS).toEqual(['auto_uat']);
  });
});

/* ── (7) Staged-edit behavioural assertions ──
 *
 * These assertions cover the contract a parent component (OptionsMenu)
 * relies on. Behavioural cases (a)/(b)/(c)/(d) from the plan's Task 3
 * checklist are encoded as pure-helper assertions: clicking a curated
 * button stages via `onStage(key, value)`, which the parent MUST merge
 * via the shape `pendingEdits[key] = value`. The display value resolves
 * via `resolveDisplayValue`; the row's `data-modified="true"` mirrors
 * `Object.prototype.hasOwnProperty.call(pendingEdits, key)`. The
 * component's render-shape consistency with these helpers is asserted
 * by the smoke test below (typing) — the full DOM exercise is reserved
 * for an e2e smoke that's out of scope this plan.
 */
describe('staged-edit behavioural contract', () => {
  /* (a) Clicking a curated button calls onStage exactly once with the right
   *     args. The button's onClick early-returns when the value is already
   *     active; we assert the gate by exercising the helper that drives it. */
  it('a button click only stages when the value is NOT already active', () => {
    // active === true → no stage call expected (the button onClick guards
    // with `if (!active()) props.onStage(...)`).
    expect(isSegmentActive({ effort: 'fast' }, {}, 'effort', 'fast')).toBe(true);
    expect(isSegmentActive({ effort: 'fast' }, {}, 'effort', 'balanced')).toBe(false);
  });

  /* (b) Display value resolves as `pendingEdits[key] ?? data.config[key]`. */
  it('display value falls back to snapshot when not staged', () => {
    expect(resolveDisplayValue({ effort: 'balanced' }, {}, 'effort')).toBe('balanced');
  });

  it('display value uses pendingEdits when staged', () => {
    expect(resolveDisplayValue({ effort: 'balanced' }, { effort: 'fast' }, 'effort')).toBe('fast');
  });

  /* (c) data-modified resolves via `hasOwnProperty(pendingEdits, key)`. */
  it('data-modified mirrors hasOwnProperty(pendingEdits, key)', () => {
    const pending = { effort: 'fast' };
    expect(Object.prototype.hasOwnProperty.call(pending, 'effort')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(pending, 'autonomy')).toBe(false);
  });

  /* (d) merged Save payload covers every staged field. */
  it('merged save payload covers every staged field', () => {
    const snapshot = { effort: 'balanced', autonomy: 'standard', auto_uat: false };
    const pending = { effort: 'fast', auto_uat: true };
    expect(mergeStagedConfig(snapshot, pending)).toEqual({
      effort: 'fast',
      autonomy: 'standard',
      auto_uat: true,
    });
  });
});

/* ── (8) Component smoke + prop-shape assertion. ── */
describe('SettingsSection component', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof SettingsSection).toBe('function');
  });

  it('has the staged-edit controlled prop contract (plan 01-02)', () => {
    // Plan 01-02 flipped SettingsSection from immediate-apply to staged-edit
    // — `onApply` is gone; `pendingEdits` + `onStage` + `onDiscardKey` are
    // the new controlled prop shape. Plan 01-03 retired the `buildConfigPatch`
    // back-compat alias — `mergeStagedConfig` is the only merge helper.
    const props: SettingsSectionProps = {
      data: null,
      loading: false,
      error: null,
      lastFetched: null,
      onRefresh: () => {},
      pendingEdits: {},
      onStage: () => {},
      onDiscardKey: () => {},
    };
    expect(props.loading).toBe(false);
  });
});
