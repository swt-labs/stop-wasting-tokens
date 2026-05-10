import type { UpdateApplyResponse, UpdateReport } from '@swt-labs/dashboard-core';
import { Show, createSignal, type Component, type JSX } from 'solid-js';

export interface UpdatePanelProps {
  data: UpdateReport | null;
  loading: boolean;
  error: string | null;
  lastFetched: string | null;
  onRefresh: () => void;
  /**
   * v2.3 Phase 03: invoked when the user clicks "Apply update".
   * Returns the daemon's UpdateApplyResponse on success — the panel
   * branches on `requires_elevation` to either show the success
   * confirmation or surface the copyable sudo command. On unexpected
   * failure (network, daemon crash) returns `{error: string}` and the
   * panel shows the error banner.
   */
  onApply: () => Promise<UpdateApplyResponse | { error: string }>;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

interface ApplyOutcome {
  ok: boolean;
  requires_elevation: boolean;
  copyable_command: string | null;
  message: string;
}

export const UpdatePanel: Component<UpdatePanelProps> = (props) => {
  const [applying, setApplying] = createSignal(false);
  const [outcome, setOutcome] = createSignal<ApplyOutcome | null>(null);
  const [copied, setCopied] = createSignal(false);

  const status = (): 'up-to-date' | 'outdated' | 'error' | 'loading' => {
    const d = props.data;
    if (!d) return 'loading';
    if (d.error !== null) return 'error';
    return d.update_available ? 'outdated' : 'up-to-date';
  };

  const handleApply = async (): Promise<void> => {
    setApplying(true);
    setOutcome(null);
    setCopied(false);
    const response = await props.onApply();
    setApplying(false);
    if ('error' in response) {
      setOutcome({
        ok: false,
        requires_elevation: false,
        copyable_command: null,
        message: response.error,
      });
      return;
    }
    setOutcome({
      ok: response.ok,
      requires_elevation: response.requires_elevation,
      copyable_command: response.copyable_command,
      message: response.ok
        ? 'Upgrade applied. Restart any running swt processes to pick up the new bin.'
        : response.requires_elevation
          ? 'Permission denied — your global npm path needs sudo. Run the command below.'
          : (response.stderr || response.stdout || 'Upgrade failed.').trim(),
    });
  };

  const handleCopy = async (): Promise<void> => {
    const cmd = outcome()?.copyable_command;
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (insecure context, permissions denied);
      // user can select + copy from the visible <code> block.
    }
  };

  return (
    <section class="panel tools-panel update-panel" aria-label="Update">
      <header class="tools-panel-header">
        <h2 class="panel-header">Update</h2>
        <button
          type="button"
          class="tools-refresh-btn"
          aria-label="Refresh update check"
          disabled={props.loading || applying()}
          onClick={props.onRefresh}
        >
          ↻
        </button>
      </header>
      <p class="tools-panel-meta">npm registry · {formatRelative(props.lastFetched)}</p>
      <Show when={props.error}>
        <p class="tools-panel-error">⚠ {props.error}</p>
      </Show>
      <Show when={props.data} fallback={<p class="tools-panel-empty">Loading…</p>}>
        {(data): JSX.Element => (
          <div class="update-body">
            <Show when={status() === 'up-to-date' && outcome() === null}>
              <p class="update-status update-status-up-to-date">
                ✓ Up to date (v{data().current_version})
              </p>
            </Show>
            <Show when={status() === 'outdated' && outcome() === null}>
              <>
                <p class="update-status update-status-outdated">
                  ↑ Update available: v{data().current_version} → v{data().latest_version ?? '?'}
                </p>
                <button
                  type="button"
                  class="update-apply-btn"
                  disabled={applying()}
                  onClick={() => void handleApply()}
                >
                  {applying() ? 'Applying…' : 'Apply update'}
                </button>
              </>
            </Show>
            <Show when={status() === 'error' && outcome() === null}>
              <p class="update-status update-status-error">
                ⚠ Could not check ({data().error ?? 'unknown error'})
              </p>
            </Show>
            <Show when={outcome()?.ok === true}>
              <p class="update-status update-status-up-to-date">✓ {outcome()!.message}</p>
            </Show>
            <Show when={outcome() !== null && outcome()!.ok === false}>
              <>
                <p class="update-status update-status-error">⚠ {outcome()!.message}</p>
                <Show when={outcome()!.copyable_command}>
                  <div class="update-elevation">
                    <code class="update-elevation-cmd">{outcome()!.copyable_command}</code>
                    <button type="button" class="update-copy-btn" onClick={() => void handleCopy()}>
                      {copied() ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </Show>
              </>
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
};
