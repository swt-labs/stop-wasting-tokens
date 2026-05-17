/**
 * `statusline-helpers` — Statusline-extension milestone, Step 4 of 8 per
 * a_non_production_files/statusline.md.
 *
 * Pure helpers for `DashboardStatusline.tsx`. node-env vitest friendly
 * (no Solid imports, no DOM, no fetch) — mirrors the existing
 * `askuser-card-helpers.ts` + `phase-card-helpers.ts` precedent.
 *
 * The dashboard treats `ConfigSnapshot.config` as `unknown` (the SwtConfig
 * shape is not fully typed in shared schemas). This module's
 * `selectStatuslineKnobs` is the typed selector that pulls the five
 * statusline knobs out of that `unknown` config and renders missing /
 * malformed values as `null` — the statusline cell then prints `—`.
 *
 * The knob name list is sourced from `CONFIG_ENUM_OPTIONS` so a typo in
 * this file would surface as a missing key at runtime (`CONFIG_ENUM_OPTIONS`
 * is hand-mirrored from `packages/core/src/config/Config.ts` — see the
 * docblock on `config-enum-vocab.ts`).
 */

import { CONFIG_ENUM_OPTIONS } from './config-enum-vocab.js';

/**
 * The five statusline knob keys, in display order (Goal section #4-7 of
 * artifacts.md + `backend` at the head per design decision §1). All five
 * render even when their value is the default — they are status
 * indicators, not differentials.
 */
export const STATUSLINE_KNOB_KEYS = [
  'backend',
  'effort',
  'autonomy',
  'model_profile',
  'verification_tier',
] as const;

export type StatuslineKnobKey = (typeof STATUSLINE_KNOB_KEYS)[number];

export type StatuslineKnobs = Readonly<Record<StatuslineKnobKey, string | null>>;

/**
 * Defensive extraction. Returns `null` for any key when:
 *   - `config` is null / undefined / non-object
 *   - the key is missing
 *   - the value is not a string
 *   - the value is the empty string
 *   - the value is not in `CONFIG_ENUM_OPTIONS[key]` (drift guard — an
 *     operator who edited config.json to a typo gets a quiet `—`, not a
 *     mystery value in the statusline)
 *
 * Strings outside the enum vocabulary are tolerated when the key has no
 * `CONFIG_ENUM_OPTIONS[key]` entry (defensive — adding a knob to this
 * helper before sync to `config-enum-vocab.ts` shouldn't crash the
 * dashboard).
 */
export function selectStatuslineKnobs(config: unknown): StatuslineKnobs {
  // Build the all-null fallback first; we'll overlay validated values.
  const result: Record<StatuslineKnobKey, string | null> = {
    backend: null,
    effort: null,
    autonomy: null,
    model_profile: null,
    verification_tier: null,
  };

  if (config === null || typeof config !== 'object') {
    return result;
  }
  const rec = config as Record<string, unknown>;

  for (const key of STATUSLINE_KNOB_KEYS) {
    const raw = rec[key];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const allowed = CONFIG_ENUM_OPTIONS[key];
    if (allowed !== undefined && !allowed.includes(raw)) continue;
    result[key] = raw;
  }
  return result;
}
