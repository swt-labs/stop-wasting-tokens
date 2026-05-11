/**
 * Pi Extension factory that applies `runtime/providers/quirks.json` to Pi's
 * provider registry via `pi.registerProvider(...)`.
 *
 * Per TDD2 §5.7 (Pi's provider-registration surface) + ADR-003 (quirks.json
 * as the single source of truth, not per-provider TS shims).
 *
 * The factory is intentionally tiny: it walks the JSON, builds per-provider
 * config objects from the `compat` + `thinkingLevelMap` entries, and hands
 * them to Pi. Pi merges the overrides over its built-in provider catalog.
 * Adding a new provider quirk = adding a JSON entry; no TS change required.
 */

import quirksJson from '../providers/quirks.json' with { type: 'json' };

import type { ProviderQuirks } from '../providers/types.js';

// Pi's `ExtensionAPI` is the documented Pi-side handle. Type-only import so
// PR-08 compiles without a runtime Pi value-import (PR-08 doesn't actually
// register the extension yet — wiring happens when the Extension API is
// brought online in PR-09's swt_report_result work).
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// JSON import shape is loose `unknown`; cast through ProviderQuirks. The
// `_comment` key in the JSON is ignored at apply time (we iterate provider
// names; `_comment` falls through harmlessly because it has no `models` field).
const QUIRKS: ProviderQuirks = quirksJson as unknown as ProviderQuirks;

/**
 * Quirks shape that gets handed to Pi per provider. The Pi-side
 * `registerProvider` accepts a config object with these fields per its
 * docs (TDD2 §5.7); PR-08 codifies the shape so Pi-side schema changes
 * surface as TS errors here.
 */
interface PiProviderConfig {
  models: Array<{
    id?: string;
    pattern?: string;
    thinkingLevelMap?: Record<string, string | null>;
    compat?: Record<string, unknown>;
  }>;
  compat?: Record<string, unknown>;
}

function buildProviderConfig(name: string, quirk: ProviderQuirks[string]): PiProviderConfig {
  void name;
  const config: PiProviderConfig = { models: [] };
  if (quirk.compat) {
    config.compat = { ...quirk.compat };
  }
  if (quirk.models) {
    for (const [modelGlob, modelOverrides] of Object.entries(quirk.models)) {
      const entry: PiProviderConfig['models'][number] = {};
      if (modelGlob.includes('*')) {
        entry.pattern = modelGlob;
      } else {
        entry.id = modelGlob;
      }
      if (modelOverrides.thinkingLevelMap) {
        // Drop undefined entries so Pi sees only explicit mappings.
        const tlm: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(modelOverrides.thinkingLevelMap)) {
          if (v !== undefined) tlm[k] = v;
        }
        entry.thinkingLevelMap = tlm;
      }
      if (modelOverrides.compat) {
        entry.compat = { ...modelOverrides.compat };
      }
      config.models.push(entry);
    }
  }
  return config;
}

/**
 * Extension factory. Pi's loader calls this with its `ExtensionAPI` handle;
 * we iterate the JSON and register each provider's overrides.
 *
 * Returned value is the side-effect free factory; consumers wire it via
 * Pi's extension loader once they have a real Pi session (PR-09 territory).
 */
export default function providerOverridesExtension(pi: ExtensionAPI): void {
  for (const [providerName, quirk] of Object.entries(QUIRKS)) {
    if (providerName.startsWith('_')) continue; // skip the `_comment` JSON key
    const config = buildProviderConfig(providerName, quirk);
    // Pi's registerProvider type signature varies across versions; defer
    // the exact call until the cassette infra (PR-06 → first recording)
    // gives us a real session to test against. For PR-08, the factory
    // compiles + the config-building logic is unit-tested.
    void pi;
    void config;
  }
}

/**
 * Test seam: returns the same config objects buildProviderConfig produces,
 * keyed by provider, so unit tests can assert against the structure
 * without invoking a real Pi `ExtensionAPI`.
 */
export function buildAllProviderConfigs(): Record<string, PiProviderConfig> {
  const out: Record<string, PiProviderConfig> = {};
  for (const [providerName, quirk] of Object.entries(QUIRKS)) {
    if (providerName.startsWith('_')) continue;
    out[providerName] = buildProviderConfig(providerName, quirk);
  }
  return out;
}
