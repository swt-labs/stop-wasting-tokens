/**
 * Plan 03-01 (Dashboard Options Menu — Phase 3) — the Commands surface
 * mounted into `OptionsMenu`'s `commandsSection` slot.
 *
 * `CommandsSection` is FULLY props-CONTROLLED (mirrors `CommandPalette` /
 * `SettingsSection` / `ProviderAuthPanel`): the parent (`App.tsx`) owns the
 * fetched `verbs` list (off the existing `state.tools.commands` cell — the
 * SAME cell `CommandPalette` consumes) and the dispatch round-trips
 * (`actions.runCommand` for safe verbs, `actions.startVibeSession` for the
 * cook-start arm). The component owns ONLY local UI signals — the in-flight
 * verb name and the most-recent dispatch feedback. It is store-free,
 * runtime-free, and does no network I/O of its own — every round-trip is a
 * prop the parent threads in.
 *
 * The Commands section is the CURATED complement to the Cmd-K
 * `CommandPalette` (the fuzzy-search surface stays unchanged): the verb
 * registry surfaced as grouped, always-one-click buttons.
 *
 * R2 — the per-verb dispatch decision (see the plan's `## Decisions`) is
 * factored into the pure `classifyVerbAction` helper:
 *   - `dashboard_safe` verb       → `'safe-dispatch'` (one-click POST /api/command)
 *   - `vibe`                      → `'cook-start'` (routes through POST /api/cook/start)
 *   - interactive & not `vibe`    → `'disabled-interactive'` (watch / dashboard)
 *   - otherwise (stub / unknown)  → `'disabled-stub'`
 * HARD RULE: only `'safe-dispatch'` one-click-dispatches; `'cook-start'`
 * routes through the detached cook spawn; `'disabled-*'` buttons are
 * `disabled` and never fire a request — NO Options button can launch an
 * interactive flow that then hangs waiting on stdin.
 *
 * Load-bearing logic is factored into the exported pure helpers
 * (`classifyVerbAction`, `groupVerbsByCategory`, `summarizeCommandRun`) so
 * they can be unit-tested in the dashboard's node-env vitest — the
 * workspace has no `@solidjs/testing-library` (same constraint documented
 * in `provider-auth-panel.test.ts` / `options-menu.test.ts`).
 */

import type { CommandResponse, CommandSpec } from '@swt-labs/shared';
import { For, Show, createSignal, type Component, type JSX } from 'solid-js';

/** The most-recent dispatch outcome, for inline display. */
export interface CommandRunFeedback {
  verb: string;
  ok: boolean;
  summary: string;
}

export interface CommandsSectionProps {
  /** The full verb registry — from state.tools.commands.data?.verbs ?? []. */
  verbs: ReadonlyArray<CommandSpec>;
  /** The commands tools-cell loading flag. */
  loading: boolean;
  /** The commands tools-cell fetch error, if any. */
  error: string | null;
  /** Dispatch a dashboard_safe verb. Wraps actions.runCommand — POST /api/command. */
  onRunSafeVerb: (verb: string) => Promise<CommandResponse | null>;
  /** Route the `vibe` verb through the cook-start flow. Wraps actions.startVibeSession. */
  onStartCook: () => Promise<string | null>;
  /** Optional parent-threaded last-result (the local signal is the primary source). */
  lastResult: CommandRunFeedback | null;
}

export type VerbAction = 'safe-dispatch' | 'cook-start' | 'disabled-interactive' | 'disabled-stub';

/** R2 — the per-verb dispatch decision. LOCKED rules (see ## Decisions):
 *  - dashboard_safe → 'safe-dispatch' (one-click POST /api/command)
 *  - name === 'vibe' → 'cook-start' (routes through POST /api/cook/start)
 *  - interactive & not vibe → 'disabled-interactive' (watch/dashboard — can't run in-browser)
 *  - otherwise (stub / unknown) → 'disabled-stub'
 *  HARD RULE: only 'safe-dispatch' one-click-dispatches; 'cook-start' routes
 *  through the detached cook spawn; 'disabled-*' never fires a request. */
export function classifyVerbAction(spec: CommandSpec): VerbAction {
  if (spec.dashboard_safe) return 'safe-dispatch';
  if (spec.name === 'vibe') return 'cook-start';
  if (spec.category === 'interactive') return 'disabled-interactive';
  return 'disabled-stub';
}

/** Bucket verbs by category in a stable display order: core, interactive,
 *  stub. Empty categories are omitted. Verb order within a bucket is
 *  preserved (the registry mirror already sorts alphabetically). The union
 *  of all grouped verbs equals the input set — no verb is dropped. */
export function groupVerbsByCategory(
  verbs: ReadonlyArray<CommandSpec>,
): ReadonlyArray<{ category: string; verbs: ReadonlyArray<CommandSpec> }> {
  const ORDER = ['core', 'interactive', 'stub'] as const;
  const groups: { category: string; verbs: CommandSpec[] }[] = [];
  for (const category of ORDER) {
    const bucket = verbs.filter((v) => v.category === category);
    if (bucket.length > 0) groups.push({ category, verbs: bucket });
  }
  // Defensive: any unknown category falls into a trailing bucket so no verb is lost.
  const known = new Set<string>(ORDER);
  const rest = verbs.filter((v) => !known.has(v.category));
  if (rest.length > 0) groups.push({ category: 'other', verbs: rest });
  return groups;
}

/** Format a dispatch outcome for the inline feedback line. */
export function summarizeCommandRun(
  verb: string,
  result: CommandResponse | null,
): CommandRunFeedback {
  if (result === null) {
    return { verb, ok: false, summary: `${verb}: command failed` };
  }
  if (result.ok) {
    const firstLine = result.stdout.split('\n').find((l) => l.trim().length > 0);
    return { verb, ok: true, summary: firstLine ? `${verb}: ${firstLine}` : `${verb}: exit 0` };
  }
  const errLine = result.stderr.split('\n').find((l) => l.trim().length > 0);
  return {
    verb,
    ok: false,
    summary: errLine ? `${verb}: ${errLine}` : `${verb}: exit ${result.exit_code}`,
  };
}

export const CommandsSection: Component<CommandsSectionProps> = (props) => {
  // Local UI signals only — the in-flight verb name and the most-recent
  // dispatch outcome. `localFeedback` is the primary source; `props.lastResult`
  // is an optional parent-threaded fallback for display across menu close/open.
  const [pendingVerb, setPendingVerb] = createSignal<string | null>(null);
  const [localFeedback, setLocalFeedback] = createSignal<CommandRunFeedback | null>(null);

  const runSafe = async (name: string): Promise<void> => {
    if (pendingVerb() !== null) return; // ignore re-clicks while busy
    setPendingVerb(name);
    try {
      const result = await props.onRunSafeVerb(name);
      setLocalFeedback(summarizeCommandRun(name, result));
    } catch {
      // A thrown round-trip is surfaced as the generic 'command failed' line.
      setLocalFeedback(summarizeCommandRun(name, null));
    } finally {
      setPendingVerb(null);
    }
  };

  const runCook = async (): Promise<void> => {
    if (pendingVerb() !== null) return;
    setPendingVerb('vibe');
    try {
      const sessionId = await props.onStartCook();
      setLocalFeedback(
        sessionId
          ? { verb: 'vibe', ok: true, summary: 'vibe: cook session started' }
          : { verb: 'vibe', ok: false, summary: 'vibe: cook start failed' },
      );
    } catch {
      setLocalFeedback({ verb: 'vibe', ok: false, summary: 'vibe: cook start failed' });
    } finally {
      setPendingVerb(null);
    }
  };

  const feedback = (): CommandRunFeedback | null => localFeedback() ?? props.lastResult;

  return (
    <div class="commands-section">
      <Show when={props.error}>
        <p class="tools-panel-error">{props.error}</p>
      </Show>
      <Show when={!props.error && props.loading && props.verbs.length === 0}>
        <p class="commands-section-loading">Loading…</p>
      </Show>
      <Show when={!props.error && !props.loading && props.verbs.length === 0}>
        <p class="tools-panel-empty">No commands available</p>
      </Show>
      <Show when={!props.error && props.verbs.length > 0}>
        <For each={groupVerbsByCategory(props.verbs)}>
          {(group): JSX.Element => (
            <div class="commands-section-group">
              <h4 class="commands-section-group-heading">{group.category}</h4>
              <div class="commands-section-verb-list">
                <For each={group.verbs}>
                  {(spec): JSX.Element => {
                    const action = classifyVerbAction(spec);
                    const disabled = (): boolean =>
                      action === 'disabled-interactive' ||
                      action === 'disabled-stub' ||
                      pendingVerb() !== null;
                    const affordance =
                      action === 'disabled-interactive'
                        ? 'run from your terminal'
                        : action === 'disabled-stub'
                          ? 'not available from the dashboard'
                          : (spec.usage ?? '');
                    return (
                      <button
                        type="button"
                        class={`commands-section-verb ${
                          pendingVerb() === spec.name ? 'commands-section-verb-busy' : ''
                        }`}
                        data-verb={spec.name}
                        data-action={action}
                        disabled={disabled()}
                        title={affordance}
                        onClick={(): void => {
                          if (action === 'safe-dispatch') void runSafe(spec.name);
                          else if (action === 'cook-start') void runCook();
                          // disabled-* : the button is `disabled`, onClick never fires
                        }}
                      >
                        <span class="commands-section-verb-name">{spec.name}</span>
                        <Show when={affordance}>
                          <span class="commands-section-verb-usage">{affordance}</span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          )}
        </For>
      </Show>
      <Show when={feedback()}>
        {(fb): JSX.Element => (
          <p class={`commands-section-feedback ${fb().ok ? '' : 'tools-panel-error'}`}>
            {fb().summary}
          </p>
        )}
      </Show>
    </div>
  );
};
