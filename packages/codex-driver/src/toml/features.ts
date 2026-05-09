/**
 * Codex feature flag block. Emits a proper `[features]` table header so the
 * Codex TOML parser reads it as a stand-alone section rather than an inline
 * sub-table on a `features = { ... }` line. Empty input returns an empty
 * string so the caller can no-op cleanly.
 *
 * Avoids `emitToml({ features: ... })` because that path applies an
 * inline-table heuristic for primitive-only sub-objects, which is wrong for
 * Codex feature flags.
 */
export function emitFeaturesToml(flags: Readonly<Record<string, boolean>>): string {
  const keys = Object.keys(flags);
  if (keys.length === 0) return '';
  const lines = ['[features]'];
  for (const key of keys) {
    lines.push(`${key} = ${flags[key] ? 'true' : 'false'}`);
  }
  return `${lines.join('\n')}\n`;
}
