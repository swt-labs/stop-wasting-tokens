/**
 * Phase 02 plan 02-02 — pure-helper unit tests for the SettingsTable
 * cluster (SettingsTable + SettingsValueControl + setting-descriptions).
 *
 * Test convention (Scout RESEARCH.md §1 / drift-lock 3): all assertions are
 * pure-function calls. The dashboard workspace has no Solid testing-library
 * and the vitest config runs `environment: 'node'` with no JSX transform,
 * so component bodies are never instantiated — only the exported pure
 * helpers + `typeof X === 'function'` smoke imports. Same pattern as
 * `settings-section.test.ts` and `options-menu.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  SETTINGS_ARRAY_FIELDS,
  SETTINGS_BOOLEAN_FIELDS,
  SETTINGS_NUMBER_FIELDS,
} from '../src/client/components/config-enum-vocab.js';
import {
  SETTING_DESCRIPTIONS,
  SETTINGS_DISPLAY_ORDER,
} from '../src/client/components/setting-descriptions.js';
import {
  SettingsTable,
  currentValueFor,
  formatValue,
  isModified,
} from '../src/client/components/SettingsTable.jsx';
import {
  SettingsValueControl,
  inferControlType,
  isUnlimitedRounds,
} from '../src/client/components/SettingsValueControl.jsx';

/* ── (1) SettingsTable helpers — formatValue / currentValueFor / isModified ── */
describe('SettingsTable helpers', () => {
  it('formatValue renders booleans as on/off', () => {
    expect(formatValue(true)).toBe('on');
    expect(formatValue(false)).toBe('off');
  });

  it('formatValue renders arrays as comma-joined; empty arrays as (none)', () => {
    expect(formatValue(['docs', 'qa'])).toBe('docs, qa');
    expect(formatValue([])).toBe('(none)');
  });

  it('formatValue renders strings + numbers verbatim, null/undefined as empty string', () => {
    expect(formatValue('balanced')).toBe('balanced');
    expect(formatValue(5)).toBe('5');
    expect(formatValue(null)).toBe('');
    expect(formatValue(undefined)).toBe('');
  });

  it('currentValueFor returns pendingEdits override when present, else config value', () => {
    const config = { effort: 'balanced', auto_uat: false };
    const pending = { effort: 'turbo' };
    expect(currentValueFor('effort', config, pending)).toBe('turbo');
    expect(currentValueFor('auto_uat', config, pending)).toBe(false);
  });

  it('currentValueFor returns the pendingEdits value even when it is `false` (falsy-safe)', () => {
    const config = { auto_uat: true };
    const pending = { auto_uat: false };
    expect(currentValueFor('auto_uat', config, pending)).toBe(false);
  });

  it('isModified returns true only for pendingEdits own properties', () => {
    expect(isModified('effort', { effort: 'turbo' })).toBe(true);
    expect(isModified('effort', {})).toBe(false);
    // Explicit undefined is still a modification (own property exists).
    expect(isModified('effort', { effort: undefined })).toBe(true);
  });

  it('SettingsTable is a callable function (smoke)', () => {
    expect(typeof SettingsTable).toBe('function');
  });
});

/* ── (2) SettingsValueControl helpers — inferControlType / isUnlimitedRounds ── */
describe('SettingsValueControl helpers', () => {
  it('inferControlType dispatches enum fields to "enum"', () => {
    expect(inferControlType('effort')).toBe('enum');
    expect(inferControlType('discussion_mode')).toBe('enum');
    expect(inferControlType('visual_format')).toBe('enum');
    expect(inferControlType('caveman_style')).toBe('enum');
  });

  it('inferControlType dispatches boolean fields to "boolean"', () => {
    expect(inferControlType('auto_uat')).toBe('boolean');
    expect(inferControlType('auto_commit')).toBe('boolean');
    expect(inferControlType('skill_suggestions')).toBe('boolean');
    expect(inferControlType('require_phase_discussion')).toBe('boolean');
  });

  it('inferControlType dispatches number fields to "number"', () => {
    expect(inferControlType('max_tasks_per_plan')).toBe('number');
  });

  it('inferControlType dispatches array fields to "array"', () => {
    expect(inferControlType('qa_skip_agents')).toBe('array');
  });

  it('inferControlType dispatches max_uat_remediation_rounds to "union"', () => {
    expect(inferControlType('max_uat_remediation_rounds')).toBe('union');
  });

  it('inferControlType falls back to "string" for unknown / active_profile', () => {
    expect(inferControlType('active_profile')).toBe('string');
    expect(inferControlType('an_unknown_field')).toBe('string');
  });

  it('isUnlimitedRounds is true only when value is exactly false', () => {
    expect(isUnlimitedRounds(false)).toBe(true);
    expect(isUnlimitedRounds(0)).toBe(false);
    expect(isUnlimitedRounds(1)).toBe(false);
    expect(isUnlimitedRounds(undefined)).toBe(false);
    expect(isUnlimitedRounds(null)).toBe(false);
  });

  it('SettingsValueControl is a callable function (smoke)', () => {
    expect(typeof SettingsValueControl).toBe('function');
  });
});

/* ── (3) setting-descriptions — display order ↔ description one-to-one ── */
describe('setting-descriptions', () => {
  it('SETTING_DESCRIPTIONS has exactly 24 entries', () => {
    expect(Object.keys(SETTING_DESCRIPTIONS)).toHaveLength(24);
  });

  it('SETTINGS_DISPLAY_ORDER has exactly 24 keys', () => {
    expect(SETTINGS_DISPLAY_ORDER).toHaveLength(24);
  });

  it('every SETTINGS_DISPLAY_ORDER key has a SETTING_DESCRIPTIONS entry', () => {
    for (const key of SETTINGS_DISPLAY_ORDER) {
      expect(SETTING_DESCRIPTIONS).toHaveProperty(key);
      expect((SETTING_DESCRIPTIONS[key] ?? '').length).toBeGreaterThan(0);
    }
  });

  it('every SETTING_DESCRIPTIONS key is in SETTINGS_DISPLAY_ORDER (one-to-one)', () => {
    for (const key of Object.keys(SETTING_DESCRIPTIONS)) {
      expect(SETTINGS_DISPLAY_ORDER).toContain(key);
    }
  });

  it('SETTINGS_DISPLAY_ORDER does NOT contain `backend` (intentionally excluded)', () => {
    expect(SETTINGS_DISPLAY_ORDER).not.toContain('backend');
  });

  it('every SETTINGS_DISPLAY_ORDER key has an inferred control type (no unhandled keys)', () => {
    // The dispatch table covers each key with one of the 6 control types.
    // `'string'` is the fallback, so this is really a coverage assertion:
    // each row in the table is renderable.
    const types: Record<string, true> = {
      enum: true,
      boolean: true,
      number: true,
      array: true,
      union: true,
      string: true,
    };
    for (const key of SETTINGS_DISPLAY_ORDER) {
      expect(types[inferControlType(key)]).toBe(true);
    }
  });
});

/* ── (4) config-enum-vocab — drift-lock regressions ── */
describe('config-enum-vocab field-type maps', () => {
  it('SETTINGS_BOOLEAN_FIELDS has the 9 Phase 02 entries', () => {
    expect(SETTINGS_BOOLEAN_FIELDS).toHaveLength(9);
  });

  it('SETTINGS_NUMBER_FIELDS contains max_tasks_per_plan', () => {
    expect(SETTINGS_NUMBER_FIELDS).toEqual(['max_tasks_per_plan']);
  });

  it('SETTINGS_ARRAY_FIELDS contains qa_skip_agents', () => {
    expect(SETTINGS_ARRAY_FIELDS).toEqual(['qa_skip_agents']);
  });
});
