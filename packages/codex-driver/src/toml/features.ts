import { emitToml } from './emit.js';

/**
 * Codex feature flag block. Currently a stub — no SWT-required flags yet.
 * When a future Codex release ships a feature flag SWT depends on, list it
 * here and emit the corresponding `[features]` table.
 */
export function emitFeaturesToml(flags: Readonly<Record<string, boolean>>): string {
  const entries = Object.fromEntries(Object.entries(flags));
  if (Object.keys(entries).length === 0) return '';
  return emitToml({ features: entries });
}
