import { For, Show, createSignal, type Component } from 'solid-js';

import type { DetectionResult } from '../lib/detect-extension-interference.js';

const DISMISS_KEY = 'swt-extension-banner-dismissed-session';

export interface ExtensionDefenseBannerProps {
  readonly detection: DetectionResult;
}

function isDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissThisSession(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // sessionStorage might be unavailable (private mode in some browsers,
    // or storage quota issues). Fall back to no-op; banner re-renders on
    // next page load but that's strictly less broken than silent failure.
  }
}

/**
 * Amber warning banner shown at the top of the dashboard when a browser
 * extension is detected that may interfere with the SPA's runtime
 * behavior. Dismissable for the current session via sessionStorage —
 * persists if the user reloads but clears on a fresh tab.
 *
 * This is the v2.3.4 safety net for the primary CSP-based defense. If
 * the CSP header successfully blocks the extension, the detector finds
 * nothing and this component renders null. If something gets through
 * anyway, the user sees an actionable message instead of a mysteriously
 * broken command bar.
 */
export const ExtensionDefenseBanner: Component<ExtensionDefenseBannerProps> = (props) => {
  const [dismissed, setDismissed] = createSignal(isDismissedThisSession());

  return (
    <Show when={props.detection.interferenceDetected && !dismissed()}>
      <div
        class="ext-banner"
        role="alert"
        aria-live="polite"
        data-testid="extension-defense-banner"
      >
        <div class="ext-banner-header">
          <span class="ext-banner-icon" aria-hidden="true">
            ⚠
          </span>
          <span class="ext-banner-title">Browser extension detected</span>
          <button
            type="button"
            class="ext-banner-dismiss"
            aria-label="Dismiss extension warning for this session"
            onClick={() => {
              dismissThisSession();
              setDismissed(true);
            }}
          >
            ×
          </button>
        </div>
        <p class="ext-banner-body">{props.detection.remediation}</p>
        <Show when={props.detection.sources.length > 0}>
          <ul class="ext-banner-sources">
            <For each={props.detection.sources}>
              {(s) => (
                <li class="ext-banner-source">
                  <span class="ext-banner-source-category" data-category={s.category}>
                    {s.category}
                  </span>
                  <span class="ext-banner-source-label">{s.label}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
};
