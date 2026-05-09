import { Show, createSignal, type Component } from 'solid-js';

import type { UatModalState } from '../state/dashboard-store.js';

export interface UatModalProps {
  modal: UatModalState | null;
  submitting: boolean;
  onSubmit: (result: 'pass' | 'fail', note: string | undefined) => void;
  onClose: () => void;
}

export const UatModal: Component<UatModalProps> = (props) => {
  const [note, setNote] = createSignal('');

  const handleSubmit = (result: 'pass' | 'fail'): void => {
    const trimmed = note().trim();
    props.onSubmit(result, trimmed.length > 0 ? trimmed : undefined);
    setNote('');
  };

  return (
    <Show when={props.modal}>
      <div class="uat-modal-backdrop" role="dialog" aria-modal="true" aria-label="UAT Checkpoint">
        <div class="uat-modal">
          <header class="uat-modal-header">
            <h2>
              UAT Checkpoint — Phase {props.modal!.phase}
              <Show when={props.modal!.plan}>
                <span class="topbar-sep"> · </span>
                <span class="uat-modal-plan">{props.modal!.plan}</span>
              </Show>
            </h2>
            <button
              type="button"
              class="uat-modal-close"
              aria-label="Close"
              onClick={() => props.onClose()}
              disabled={props.submitting}
            >
              ✕
            </button>
          </header>
          <p class="uat-modal-scenario">{props.modal!.scenario}</p>
          <textarea
            class="uat-modal-note"
            placeholder="Optional notes (Fira Code 13px)"
            value={note()}
            onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)}
            disabled={props.submitting}
          />
          <div class="uat-modal-actions">
            <button
              type="button"
              class="uat-modal-fail"
              onClick={() => handleSubmit('fail')}
              disabled={props.submitting}
            >
              ✗ FAIL
            </button>
            <button
              type="button"
              class="uat-modal-pass"
              onClick={() => handleSubmit('pass')}
              disabled={props.submitting}
            >
              ✓ PASS
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
