import type { WorktreeJournalEntry, WorktreeState } from '@swt-labs/shared';
import { For, Show, createSignal, onCleanup, onMount, type Component } from 'solid-js';

/**
 * `WorktreesPanel` — live worktree FSM state per TDD2 §9.1.
 *
 * Connects to `GET /api/worktrees/sse` on mount. The route emits one
 * `worktree.snapshot` frame on connect (initial map), then a stream of
 * `worktree.update` frames per appended journal entry. The panel keeps a
 * local `Map<taskId, WorktreeJournalEntry>` in sync and renders one row
 * per active worktree.
 *
 * Per Plan 03-04, the panel is read-only — operator actions (force-remove,
 * prune-locks) ship as `swt cleanup` (PR-29), not as UI controls.
 *
 * Empty state ("no active worktrees") is the correct UX for a greenfield
 * project + a project that hasn't dispatched parallel tasks yet.
 */
export const WorktreesPanel: Component = () => {
  const [worktrees, setWorktrees] = createSignal<ReadonlyMap<string, WorktreeJournalEntry>>(
    new Map(),
  );
  const [connectionState, setConnectionState] = createSignal<'connecting' | 'open' | 'closed'>(
    'connecting',
  );
  let eventSource: EventSource | null = null;

  onMount(() => {
    eventSource = new EventSource('/api/worktrees/sse');
    eventSource.addEventListener('worktree.snapshot', (e) => {
      setConnectionState('open');
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as {
          worktrees?: Record<string, WorktreeJournalEntry>;
        };
        const next = new Map<string, WorktreeJournalEntry>();
        for (const [taskId, entry] of Object.entries(data.worktrees ?? {})) {
          next.set(taskId, entry);
        }
        setWorktrees(next);
      } catch {
        // ignore malformed frames; the route validates server-side
      }
    });
    eventSource.addEventListener('worktree.update', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as {
          entry?: WorktreeJournalEntry;
        };
        if (data.entry === undefined) return;
        const entry = data.entry;
        setWorktrees((prev) => {
          const next = new Map(prev);
          next.set(entry.taskId, entry);
          return next;
        });
      } catch {
        // ignore malformed frames
      }
    });
    eventSource.addEventListener('error', () => {
      setConnectionState('closed');
    });
  });

  onCleanup(() => {
    if (eventSource !== null) {
      eventSource.close();
      eventSource = null;
    }
  });

  const sortedRows = (): ReadonlyArray<WorktreeJournalEntry> => {
    const map = worktrees();
    return Array.from(map.values()).sort((a, b) => a.taskId.localeCompare(b.taskId));
  };

  return (
    <section class="panel worktrees-panel" aria-label="Active worktrees">
      <h2 class="panel-header">
        Worktrees
        <Show when={connectionState() !== 'open'}>
          <span class="worktrees-conn-status"> ({connectionState()})</span>
        </Show>
      </h2>
      <Show
        when={sortedRows().length > 0}
        fallback={<div class="worktrees-empty">No active worktrees</div>}
      >
        <table class="worktrees-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>State</th>
              <th>Transition</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            <For each={sortedRows()}>
              {(row) => (
                <tr>
                  <td class="worktrees-task-id">{row.taskId}</td>
                  <td>
                    <span class={`worktree-state-pill worktree-state-${row.to}`}>{row.to}</span>
                  </td>
                  <td class="worktrees-transition">
                    {row.from}
                    {' → '}
                    {row.to}
                  </td>
                  <td class="worktrees-timestamp" title={row.timestamp}>
                    {formatRelativeTime(row.timestamp)}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
};

const ABS_FALLBACK_MS = 24 * 60 * 60 * 1000;

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaMs = Date.now() - t;
  if (deltaMs < 0) return iso;
  if (deltaMs < 5_000) return 'just now';
  if (deltaMs < 60_000) return `${Math.round(deltaMs / 1000)}s ago`;
  if (deltaMs < 3_600_000) return `${Math.round(deltaMs / 60_000)}m ago`;
  if (deltaMs < ABS_FALLBACK_MS) return `${Math.round(deltaMs / 3_600_000)}h ago`;
  return iso;
}

// Exported for tests + sibling components that want type-level coupling.
export type { WorktreeJournalEntry, WorktreeState };
