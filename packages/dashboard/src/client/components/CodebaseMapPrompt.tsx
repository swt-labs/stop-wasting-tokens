/**
 * Milestone 23 Phase 03 T02 — persistent dashboard banner that surfaces the
 * "map this codebase" affordance for brownfield projects that have NOT yet
 * been mapped.
 *
 * Conditional render:
 *   - snapshot is non-null AND
 *   - snapshot.is_initialized === true (banner only meaningful for init'd projects) AND
 *   - snapshot.brownfield === true (greenfield projects don't need mapping) AND
 *   - snapshot.codebase_mapped === false (don't re-show once mapped)
 *
 * Click triggers `actions.startCodebaseMap()` (PA-1 hoisted action) which
 * fires `postMap()`. The banner flips to "Mapping…" while
 * `state.isMappingCodebase === true`, and auto-hides when the snapshotter's
 * SSE-driven `state.changed` event flips `codebase_mapped` to `true`
 * (PA-5 / PA-4 — no new SSE event variants this phase).
 *
 * Vendor-agnostic at the UI layer (Locked Decision #10): the banner reads
 * no provider-auth tools-cell data. The auth gate is checked inside
 * `swt map` CLI itself — if no provider is configured the subprocess
 * exits non-zero and the 5s watchdog publishes a `MAP_SPAWN_FAILED`
 * ErrorEvent which the dashboard-store's pushError handler surfaces as
 * a toast.
 *
 * Component is purely prop-driven (no direct store access) so the helpers
 * stay easy to test in vitest node-env and App.tsx remains the single
 * mount-point that wires the store → component. Mirrors the InitScreen
 * pattern.
 */

import type { Snapshot } from '@swt-labs/shared';
import { Show, type Component } from 'solid-js';

/**
 * Pure helper — should the banner render right now? Exported for unit
 * testing (vitest node-env, no Solid testing-library — Phase 02 convention).
 *
 * Returns `true` iff ALL of:
 *   - snapshot is non-null/undefined
 *   - snapshot.is_initialized === true
 *   - snapshot.brownfield === true (defaults to false when absent — old
 *     snapshots without the field are pre-milestone-23 and either
 *     greenfield or unmapped brownfield; either way the banner stays
 *     hidden until the snapshotter sees `.swt-planning/stack.json`)
 *   - snapshot.codebase_mapped === false (defaults to false when absent —
 *     a banner re-show on undefined matches the "not yet mapped" intent)
 */
export function shouldShowMapPrompt(snapshot: Snapshot | null | undefined): boolean {
  if (!snapshot) return false;
  if (snapshot.is_initialized !== true) return false;
  if ((snapshot.brownfield ?? false) !== true) return false;
  if ((snapshot.codebase_mapped ?? false) === true) return false;
  return true;
}

/**
 * Pure helper — classify the banner's in-flight state for label rendering.
 * Exported for unit testing.
 *
 *   - `'mapped'`  — snapshot.codebase_mapped === true (banner would not
 *                   render via shouldShowMapPrompt, but the helper is
 *                   well-defined for the test suite and for any future
 *                   surface that may want to render "✓ Mapped").
 *   - `'mapping'` — codebase_mapped !== true AND the action is in flight.
 *   - `'absent'`  — codebase_mapped !== true AND not in flight (idle CTA).
 */
export function describeMapState(
  snapshot: Snapshot | null | undefined,
  isMappingCodebase: boolean,
): 'absent' | 'mapping' | 'mapped' {
  if ((snapshot?.codebase_mapped ?? false) === true) return 'mapped';
  if (isMappingCodebase) return 'mapping';
  return 'absent';
}

export interface CodebaseMapPromptProps {
  /** Accessor for the live snapshot — Solid reactivity tracks the read. */
  snapshot: () => Snapshot | null | undefined;
  /** Accessor for the hoisted in-flight flag from the dashboard store. */
  isMappingCodebase: () => boolean;
  /** Callback wired in App.tsx to `actions.startCodebaseMap()`. */
  onMapCodebase: () => void;
}

export const CodebaseMapPrompt: Component<CodebaseMapPromptProps> = (props) => {
  return (
    <Show when={shouldShowMapPrompt(props.snapshot())}>
      <div class="codebase-map-prompt" role="region" aria-label="Map codebase">
        <div class="codebase-map-prompt-icon" aria-hidden="true">
          ◆
        </div>
        <div class="codebase-map-prompt-text">
          <div class="codebase-map-prompt-headline">
            {props.isMappingCodebase() ? 'Mapping codebase…' : 'Map this codebase'}
          </div>
          <div class="codebase-map-prompt-detail">
            Run 4 parallel Scout agents to map architecture, conventions, dependencies, and
            concerns. Typically takes 3–5 minutes.
          </div>
        </div>
        <div class="codebase-map-prompt-cta">
          <button
            type="button"
            class="codebase-map-prompt-button"
            disabled={props.isMappingCodebase()}
            onClick={() => props.onMapCodebase()}
          >
            {props.isMappingCodebase() ? 'Mapping…' : 'Map codebase'}
          </button>
        </div>
      </div>
    </Show>
  );
};
