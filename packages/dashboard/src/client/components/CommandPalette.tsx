import type { CommandSpec } from '@swt-labs/dashboard-core';
import { For, Show, createMemo, createSignal, onCleanup, type Component, type JSX } from 'solid-js';

import { fuzzyMatch } from '../lib/fuzzy-match.js';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /**
   * Invoked when the user picks a verb from the result list (Enter or
   * click). The orchestrator wraps `actions.runCommand(verb)`. This
   * component does NOT close itself after onRun returns — the parent
   * decides (typically: close on success, leave open on rejection).
   */
  onRun: (verb: string) => Promise<void>;
  /**
   * The full command-registry verb list. Comes from
   * `state.tools.commands.data?.verbs ?? []`. Filtered + ranked
   * client-side via fuzzy-match.
   */
  verbs: ReadonlyArray<CommandSpec>;
}

const MAX_VISIBLE = 10;

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const [query, setQuery] = createSignal('');
  const [showAll, setShowAll] = createSignal(false);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [running, setRunning] = createSignal(false);

  const visibleVerbs = createMemo(() => {
    const filtered = showAll() ? props.verbs : props.verbs.filter((v) => v.dashboard_safe);
    const names = filtered.map((v) => v.name);
    const ranked = fuzzyMatch(query(), names);
    const byName = new Map(filtered.map((v) => [v.name, v]));
    const result: CommandSpec[] = [];
    for (const r of ranked) {
      const spec = byName.get(r.value);
      if (spec) result.push(spec);
      if (result.length >= MAX_VISIBLE) break;
    }
    return result;
  });

  // Reset state every time the palette opens — old query / selection
  // shouldn't leak across opens. Implemented as a Solid effect via a
  // memoized reset key: when `open` flips false → true, reset.
  let lastOpen = false;
  createMemo(() => {
    if (props.open && !lastOpen) {
      setQuery('');
      setSelectedIdx(0);
      setRunning(false);
    }
    lastOpen = props.open;
  });

  const submit = async (verb: string): Promise<void> => {
    if (running()) return;
    setRunning(true);
    try {
      await props.onRun(verb);
      props.onClose();
    } finally {
      setRunning(false);
    }
  };

  const handleKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, Math.max(0, visibleVerbs().length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const verb = visibleVerbs()[selectedIdx()];
      if (verb !== undefined) void submit(verb.name);
      return;
    }
  };

  // Always-mounted listener: only fires while open via the mounted DOM
  // input; external Esc to close is handled via the input's keydown.
  onCleanup(() => {
    /* nothing — listeners are local to the input element */
  });

  return (
    <Show when={props.open}>
      <div
        class="uat-modal-backdrop command-palette-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e): void => {
          // Close when clicking outside the modal card; ignore clicks
          // that land on the card itself (those bubble from inputs etc).
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div class="command-palette">
          <input
            type="text"
            class="command-palette-input"
            placeholder="Type to search swt verbs (Esc to close)"
            value={query()}
            autofocus
            disabled={running()}
            onInput={(e): void => {
              setQuery(e.currentTarget.value);
              setSelectedIdx(0);
            }}
            onKeyDown={handleKey}
          />
          <div class="command-palette-results">
            <Show
              when={visibleVerbs().length > 0}
              fallback={<p class="command-palette-empty">No matches.</p>}
            >
              <ul class="command-palette-list">
                <For each={visibleVerbs()}>
                  {(verb, i): JSX.Element => (
                    <li
                      class={`command-palette-row ${i() === selectedIdx() ? 'is-selected' : ''}`}
                      data-category={verb.category}
                      data-safe={verb.dashboard_safe ? 'true' : 'false'}
                      onMouseEnter={() => setSelectedIdx(i())}
                      onClick={() => void submit(verb.name)}
                    >
                      <span class="command-palette-name">{verb.name}</span>
                      <Show when={verb.usage}>
                        <span class="command-palette-usage">{verb.usage}</span>
                      </Show>
                      <span class="command-palette-desc">{verb.description}</span>
                      <Show when={!verb.dashboard_safe}>
                        <span class="command-palette-flag" title={verb.category}>
                          {verb.category === 'interactive' ? '⌨' : '✗'}
                        </span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
          <footer class="command-palette-footer">
            <label class="command-palette-toggle">
              <input
                type="checkbox"
                checked={showAll()}
                onChange={(e): void => {
                  setShowAll(e.currentTarget.checked);
                  setSelectedIdx(0);
                }}
              />
              Show all (including stubs / interactive verbs)
            </label>
            <span class="command-palette-hint">↑↓ to navigate · ↵ to run · Esc to close</span>
          </footer>
        </div>
      </div>
    </Show>
  );
};
