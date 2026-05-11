import type { Snapshot } from '@swt-labs/shared';

/**
 * Deterministic structural equality for two Snapshot values. We stringify
 * with key-sorted JSON to avoid false-positive diffs when the reducer happens
 * to emit fields in a different order. `generated_at` is intentionally
 * excluded because it changes on every rebuild — the contract is "did the
 * observable state change?", not "was the snapshot rebuilt?".
 */
export function snapshotsEqual(a: Snapshot | null, b: Snapshot | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return canonicalize(a) === canonicalize(b);
}

function canonicalize(snap: Snapshot): string {
  return JSON.stringify(snap, sortReplacer);
}

function sortReplacer(key: string, value: unknown): unknown {
  if (key === 'generated_at') return null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
