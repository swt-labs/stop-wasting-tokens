/**
 * `<ActiveAgentsPane>` — the dashboard's unified agents panel.
 *
 * Merged from the prior two stacked cards "Active Agents" + "Agents
 * (timeline)" because they were largely redundant: during a live cook
 * the same agent appeared in both. The merge keeps:
 *
 * - the cook-control header (Pause / Resume / Cancel buttons keyed off
 *   `sessionId`),
 * - the live in-flight table (`agents` map — tool, tokens, cost,
 *   elapsed),
 * - a historical timeline below it for completed agents (`events` ⇒
 *   `agent.complete` rows with their final stats).
 *
 * The historical list is filtered to ONLY render `agent.complete`
 * events so it doesn't duplicate the live table's "running" rows.
 *
 * File name + export name kept as `ActiveAgentsPane` so the existing
 * test import (`active-agents-pane.test.ts`) doesn't break — only the
 * H2 text changed from "Active agents" → "Agents".
 */

import type { AgentLiveState, SnapshotEvent } from '@swt-labs/shared';
import { For, Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';

export type CookControlAction = 'pause' | 'resume' | 'cancel';

const ROLE_ICON: Record<string, string> = {
  orchestrator: '◈',
  scout: '◇',
  lead: '◆',
  dev: '●',
  qa: '□',
  debugger: '▲',
  architect: '△',
  docs: '▽',
};

const AGENT_COLOR: Record<string, string> = {
  scout: 'var(--neon-cyan)',
  architect: 'var(--neon-cyan)',
  lead: 'var(--terminal-green)',
  dev: 'var(--terminal-green)',
  qa: 'var(--terminal-green)',
  debugger: 'var(--warm-amber)',
};

export interface ActiveAgentsPaneProps {
  agents: Accessor<Map<string, AgentLiveState>>;
  sessionId: Accessor<string | null>;
  /**
   * The historical event stream (typically `state.snapshot?.recent_events ?? []`).
   * Used to render the completed-agents history below the live table.
   * Passing an empty array is fine — the history section then renders nothing.
   */
  events?: readonly unknown[];
  /**
   * Injected for unit testing. Production callers fall back to `fetch`.
   */
  postControl?: (sessionId: string, action: CookControlAction) => Promise<unknown>;
}

interface AgentHistoryRow {
  id: string;
  agent: string;
  phase: string;
  plan: string | null;
  ts: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number;
  artifact: string | null;
}

const DEFAULT_POST_CONTROL = async (
  sessionId: string,
  action: CookControlAction,
): Promise<void> => {
  await fetch(`/api/cook/${sessionId}/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
};

export function roleIcon(role: string): string {
  return ROLE_ICON[role] ?? '·';
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.0000';
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds - minutes * 60;
  return `${minutes}m${remSec.toString().padStart(2, '0')}s`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * Narrow the `recent_events` stream (typed `z.unknown()` upstream) to
 * `agent.complete` rows only. The live table already renders running
 * agents, so the history section must NOT duplicate them.
 */
function eventsToHistoryRows(events: readonly unknown[]): AgentHistoryRow[] {
  const rows: AgentHistoryRow[] = [];
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const evt = raw as Partial<SnapshotEvent>;
    if (evt.type !== 'agent.complete') continue;
    rows.push({
      id: `${evt.ts}-${evt.agent}-${evt.phase}-complete`,
      agent: evt.agent ?? 'unknown',
      phase: evt.phase ?? '??',
      plan: evt.plan ?? null,
      ts: evt.ts ?? '',
      tokens_in: evt.tokens_in ?? 0,
      tokens_out: evt.tokens_out ?? 0,
      cost_usd: evt.cost_usd ?? 0,
      duration_ms: evt.duration_ms ?? 0,
      artifact: evt.artifact ?? null,
    });
  }
  // Newest first.
  return rows.reverse();
}

export const ActiveAgentsPane: Component<ActiveAgentsPaneProps> = (props) => {
  const post = props.postControl ?? DEFAULT_POST_CONTROL;
  const [confirmingCancel, setConfirmingCancel] = createSignal(false);
  const [pending, setPending] = createSignal<CookControlAction | null>(null);

  const liveRows = (): AgentLiveState[] =>
    Array.from(props.agents().values()).sort((a, b) => b.started_at.localeCompare(a.started_at));

  const historyRows = createMemo(() => eventsToHistoryRows(props.events ?? []));

  const sendControl = async (action: CookControlAction): Promise<void> => {
    const sid = props.sessionId();
    if (!sid) return;
    setPending(action);
    try {
      await post(sid, action);
    } finally {
      setPending(null);
    }
  };

  return (
    <section class="panel active-agents-pane" aria-label="Agents">
      <header class="active-agents-header">
        <h2 class="panel-header">Agents</h2>
        <Show
          when={props.sessionId()}
          fallback={<span class="active-agents-idle">No active cook session</span>}
        >
          <div class="active-agents-controls">
            <span class="active-agents-session">
              session <code>{props.sessionId()!.slice(0, 8)}</code>
            </span>
            <button
              type="button"
              disabled={pending() !== null}
              onClick={() => void sendControl('pause')}
            >
              Pause
            </button>
            <button
              type="button"
              disabled={pending() !== null}
              onClick={() => void sendControl('resume')}
            >
              Resume
            </button>
            <Show
              when={confirmingCancel()}
              fallback={
                <button
                  type="button"
                  class="danger"
                  disabled={pending() !== null}
                  onClick={() => setConfirmingCancel(true)}
                >
                  Cancel
                </button>
              }
            >
              <span class="active-agents-confirm">
                Cancel cook?
                <button
                  type="button"
                  class="danger"
                  disabled={pending() !== null}
                  onClick={() => {
                    setConfirmingCancel(false);
                    void sendControl('cancel');
                  }}
                >
                  Yes, cancel
                </button>
                <button type="button" onClick={() => setConfirmingCancel(false)}>
                  Keep running
                </button>
              </span>
            </Show>
          </div>
        </Show>
      </header>
      {/* Live in-flight agents table — shown only when there are live rows */}
      <Show when={liveRows().length > 0}>
        <table class="active-agents-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Status</th>
              <th>Tool</th>
              <th>Tokens (in / out)</th>
              <th>Cost</th>
              <th>Elapsed</th>
            </tr>
          </thead>
          <tbody>
            <For each={liveRows()}>
              {(row) => (
                <tr class={`status-${row.status}`}>
                  <td>
                    <span class="active-agents-role-icon" aria-hidden="true">
                      {roleIcon(row.role)}
                    </span>
                    {row.role}
                  </td>
                  <td>{row.status}</td>
                  <td>
                    <Show
                      when={row.current_tool}
                      fallback={<span class="active-agents-dash">—</span>}
                    >
                      <code title={row.current_tool_input_excerpt ?? undefined}>
                        {row.current_tool}
                      </code>
                    </Show>
                  </td>
                  <td>
                    {row.tokens_in.toLocaleString()} / {row.tokens_out.toLocaleString()}
                  </td>
                  <td>{formatCost(row.cost_usd)}</td>
                  <td>{formatElapsed(row.elapsed_ms)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
      {/* History — completed agents from recent_events (filtered to
          not duplicate the live "running" rows above) */}
      <Show when={historyRows().length > 0}>
        <ul class="agent-timeline-list" aria-live="polite">
          <For each={historyRows()}>
            {(row) => (
              <li class="agent-timeline-item" data-status="complete">
                <div class="agent-timeline-head">
                  <span
                    class="agent-timeline-role"
                    style={{ color: AGENT_COLOR[row.agent] ?? 'var(--ghost-white)' }}
                  >
                    {row.agent}
                  </span>
                  <span class="agent-timeline-status-pill" data-status="complete">
                    ✓ complete
                  </span>
                </div>
                <div class="agent-timeline-meta">
                  <span>phase {row.phase}</span>
                  <Show when={row.plan}>
                    <span class="topbar-sep">·</span>
                    <span>{row.plan}</span>
                  </Show>
                </div>
                <div class="agent-timeline-stats">
                  <span>tokens: {(row.tokens_in + row.tokens_out).toLocaleString()}</span>
                  <span>cost: {formatCost(row.cost_usd)}</span>
                  <span>took: {formatDuration(row.duration_ms)}</span>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      {/* Empty-state fallback when both live + history are empty */}
      <Show when={liveRows().length === 0 && historyRows().length === 0}>
        <p class="active-agents-empty">
          No agent activity yet. Agents will appear here once you start a cook session from the
          command bar.
        </p>
      </Show>
    </section>
  );
};
