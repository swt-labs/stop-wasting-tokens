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
import { For, Show, createMemo, createSignal, onCleanup, type Accessor, type Component } from 'solid-js';

import { compactTokens, shortModelLabel } from '../lib/model-helpers.js';

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
  /**
   * Optional artifact-selection handler. When provided, a history row's
   * `artifact` field renders as a clickable element that invokes this
   * handler with `(phase, artifact)` — wired in App.tsx to
   * `actions.selectArtifact`, the same path the Artifacts tree uses to
   * surface a file in the Preview pane. When omitted, the artifact name
   * still renders but as a non-interactive label (graceful degradation
   * for callers that don't wire the handler — e.g. unit tests).
   */
  selectArtifact?: (phase: string, artifact: string) => void;
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

/**
 * Truncate a string to `maxLen` characters, appending an ellipsis when
 * trimmed. Used for the inline `current_tool_input_excerpt` rendering
 * next to the tool name — the full text remains on the row's title
 * attribute for hover so no information is lost.
 *
 *   - input under `maxLen`     → returned unchanged
 *   - input at exactly `maxLen` → returned unchanged
 *   - input over `maxLen`      → first (maxLen − 1) chars + `…`
 */
export function truncateExcerpt(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

/**
 * Trim a Pi sub-session id to its leading 8 characters for narrow display
 * cells. The full id remains accessible via the row's copy-to-clipboard
 * button. `nano-id` style ids are typically 21 chars; 8 is enough to be
 * grep-unique within a session yet narrow enough to fit a small cell.
 */
export function formatSubSessionShort(id: string): string {
  return id.slice(0, 8);
}

/**
 * Copy a sub-session id to the clipboard. Returns `true` on success,
 * `false` when clipboard access fails or is unavailable (some
 * older browsers, insecure contexts, or test environments without
 * `navigator.clipboard`). Exported so a future commit can wire it to a
 * UI toast for explicit success / failure feedback.
 */
export async function copySubSessionId(id: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a timestamp as a human-relative phrase for compact display
 * cells. Past timestamps only — future ones (clock skew) fall back to
 * the absolute date.
 *
 *   - < 60s  → `just now`
 *   - < 60m  → `N min ago`
 *   - < 24h  → `N hr ago`
 *   - < 30d  → `N day ago`
 *   - older  → `YYYY-MM-DD HH:MM` (absolute, ISO-ish)
 *
 * `nowMs` is injected (not `Date.now()` called inline) so tests can pin
 * the clock and so a parent's `setInterval`-driven re-render can refresh
 * relative phrases consistently across rows.
 *
 * Returns `'—'` for invalid input (empty string, unparseable date) so
 * the cell renders neutrally rather than showing `NaN min ago`.
 */
export function formatRelativeTime(ts: string, nowMs: number): string {
  if (!ts) return '—';
  const past = Date.parse(ts);
  if (Number.isNaN(past)) return '—';
  const deltaMs = nowMs - past;
  if (deltaMs < 0) {
    // Future timestamp (clock skew). Fall back to absolute.
    return formatAbsoluteIso(past);
  }
  const deltaSec = Math.floor(deltaMs / 1000);
  if (deltaSec < 60) return 'just now';
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin} min ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr} hr ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  if (deltaDay < 30) return `${deltaDay} day ago`;
  return formatAbsoluteIso(past);
}

/** Internal helper for formatRelativeTime's "absolute" fallback. */
function formatAbsoluteIso(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
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

  // Refresh-driver for `formatRelativeTime` on history rows. A 30-second
  // tick keeps `5 min ago` from going stale during a long-lived dashboard
  // session without paying per-second wakes. Cleared on component teardown.
  const [nowMs, setNowMs] = createSignal(Date.now());
  const tickHandle = setInterval(() => setNowMs(Date.now()), 30_000);
  onCleanup(() => clearInterval(tickHandle));

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
              <th scope="col">Role</th>
              <th scope="col">Model</th>
              <th scope="col">Status</th>
              <th scope="col">Tool</th>
              <th scope="col">Tokens (in / out)</th>
              <th scope="col">Cache (read / created)</th>
              <th scope="col">Cost</th>
              <th scope="col">Elapsed</th>
              <th scope="col">Sub-session</th>
            </tr>
          </thead>
          <tbody>
            <For each={liveRows()}>
              {(row) => (
                <tr
                  class={`status-${row.status}`}
                  title={row.pid !== undefined ? `pid: ${row.pid}` : undefined}
                >
                  <td>
                    <span class="active-agents-role-icon" aria-hidden="true">
                      {roleIcon(row.role)}
                    </span>
                    {row.role}
                  </td>
                  <td class="active-agents-model">{shortModelLabel(row.model)}</td>
                  <td>{row.status}</td>
                  <td>
                    <Show
                      when={row.current_tool}
                      fallback={<span class="active-agents-dash">—</span>}
                    >
                      <code title={row.current_tool_input_excerpt ?? undefined}>
                        {row.current_tool}
                      </code>
                      <Show when={row.current_tool_input_excerpt}>
                        <span class="active-agents-tool-excerpt">
                          {' '}
                          ({truncateExcerpt(row.current_tool_input_excerpt!, 40)})
                        </span>
                      </Show>
                    </Show>
                  </td>
                  <td>
                    {row.tokens_in.toLocaleString()} / {row.tokens_out.toLocaleString()}
                  </td>
                  <td class="active-agents-cache">
                    {compactTokens(row.cache_read)} / {compactTokens(row.cache_creation)}
                  </td>
                  <td>{formatCost(row.cost_usd)}</td>
                  <td>{formatElapsed(row.elapsed_ms)}</td>
                  <td class="active-agents-subsession">
                    <code>{formatSubSessionShort(row.sub_session_id)}</code>
                    <button
                      type="button"
                      class="active-agents-copy-btn"
                      title="Copy full sub-session id"
                      aria-label={`Copy sub-session id ${row.sub_session_id}`}
                      onClick={() => void copySubSessionId(row.sub_session_id)}
                    >
                      📋
                    </button>
                  </td>
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
                  <span>
                    tokens: {compactTokens(row.tokens_in)} → {compactTokens(row.tokens_out)}
                  </span>
                  <span>cost: {formatCost(row.cost_usd)}</span>
                  <span>took: {formatDuration(row.duration_ms)}</span>
                  <span class="agent-timeline-relative" title={row.ts}>
                    {formatRelativeTime(row.ts, nowMs())}
                  </span>
                </div>
                <Show when={row.artifact}>
                  <div class="agent-timeline-artifact">
                    <Show
                      when={props.selectArtifact}
                      fallback={
                        <span class="agent-timeline-artifact-label">→ {row.artifact}</span>
                      }
                    >
                      <button
                        type="button"
                        class="agent-timeline-artifact-link"
                        onClick={() => props.selectArtifact?.(row.phase, row.artifact!)}
                        title={`Open ${row.artifact!} in the Preview pane`}
                      >
                        → {row.artifact}
                      </button>
                    </Show>
                  </div>
                </Show>
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
