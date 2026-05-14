/**
 * Plan 04-02 (Phase 4) — the `@earendil-works/pi-ai` OAuth subsystem driver.
 *
 * SWT does NOT build OAuth. `pi-ai` ships the complete subsystem: research
 * §1 + §5 — `getOAuthProvider(id)` returns an `OAuthProviderInterface` whose
 * `login(callbacks)` runs the authorization-code + PKCE flow AND its OWN
 * `http.createServer` loopback callback server. SWT's job is the *glue*:
 * this driver supplies the `OAuthLoginCallbacks` and bridges `pi-ai`'s
 * `onAuth` / `onProgress` / `onManualCodeInput` callbacks onto SWT-side
 * event-emitter callbacks the dashboard route wires to the SSE `EventBus`.
 *
 * The `OAuthCredentials` blob `pi-ai`'s `login()` resolves is handed to
 * `opts.onComplete` — the route's `onComplete` is what persists it to the OS
 * keychain (via `storeOAuthCredentials`). This driver NEVER logs the blob and
 * NEVER writes it to disk itself.
 */

import { getOAuthProvider } from '@earendil-works/pi-ai/oauth';
import type { OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai/oauth';

/** The set of SWT-side hooks the caller (the `/oauth/start` route) supplies —
 *  `runOAuthLoginFlow` bridges `pi-ai`'s `OAuthLoginCallbacks` onto these. */
export interface OAuthLoginFlowOptions {
  /** The OAuth provider id — must be one `pi-ai` ships an OAuth provider for:
   *  `'anthropic'` | `'openai-codex'` | `'github-copilot'`. */
  readonly provider: string;
  /** Server-generated correlator for this flow's SSE events. */
  readonly flowId: string;
  /** `pi-ai`'s `onAuth({url, instructions})` fired — bridge to
   *  `oauth.auth_url`. */
  readonly onAuthUrl: (url: string, instructions?: string) => void;
  /** `pi-ai`'s `onProgress(message)` fired — bridge to `oauth.progress`. */
  readonly onProgress: (message: string) => void;
  /** `pi-ai`'s `onManualCodeInput` invoked — bridge to `oauth.awaiting_code`.
   *  Risk 4: the headless paste-flow signal. */
  readonly onAwaitingCode: (message?: string) => void;
  /** `login()` resolved — `opts.onComplete` is what persists the blob to the
   *  keychain (the route wires `storeOAuthCredentials` here). May be async;
   *  a throw from it is caught and surfaced via `onError`. */
  readonly onComplete: (credentials: OAuthCredentials) => Promise<void> | void;
  /** `login()` rejected / aborted, or the provider is unsupported. */
  readonly onError: (code: string, message: string) => void;
  /** Optional abort signal — forwarded to `pi-ai`'s `login()`; when it fires
   *  `pi-ai` rejects `login()` and the rejection surfaces via `onError`. */
  readonly signal?: AbortSignal;
}

/** The handle `runOAuthLoginFlow` returns — the caller's affordance to feed a
 *  manually-pasted authorization code into a flow that is awaiting one. */
export interface OAuthLoginFlowHandle {
  /** Feed a manually-pasted authorization code into a flow that is awaiting
   *  one (Risk 4). No-op if the flow is not currently awaiting a code (the
   *  deferred has not been armed, or has already been resolved). */
  submitManualCode(code: string): void;
}

/**
 * Drive `pi-ai`'s OAuth subsystem for `opts.provider`.
 *
 * `getOAuthProvider(provider)` returns `undefined` for a provider with no
 * `pi-ai` OAuth implementation — in that case `onError('oauth_provider_
 * unsupported', ...)` fires, `login()` is never called, and the returned
 * handle's `submitManualCode` is a no-op. Otherwise the driver constructs the
 * `OAuthLoginCallbacks` bridge and runs `oauthProvider.login(callbacks)`.
 *
 * The function returns the `OAuthLoginFlowHandle` synchronously; the
 * `onComplete` / `onError` callbacks fire later as `login()`'s promise
 * settles (the flow is long-running — a browser round-trip).
 */
export function runOAuthLoginFlow(opts: OAuthLoginFlowOptions): OAuthLoginFlowHandle {
  const oauthProvider = getOAuthProvider(opts.provider);
  if (oauthProvider === undefined) {
    opts.onError('oauth_provider_unsupported', `No OAuth provider for '${opts.provider}'`);
    // The flow never started — `submitManualCode` has nothing to feed.
    return { submitManualCode: () => {} };
  }

  // The manual-code deferred (Risk 4). `pi-ai`'s `onManualCodeInput` returns
  // the promise; the handle's `submitManualCode` resolves it. `resolveManualCode`
  // is armed only while `pi-ai` is awaiting a code, and is nulled once fed so
  // a second `submitManualCode` is a no-op.
  let resolveManualCode: ((code: string) => void) | null = null;

  const callbacks: OAuthLoginCallbacks = {
    onAuth: (info) => {
      opts.onAuthUrl(info.url, info.instructions);
    },
    onProgress: (message) => {
      opts.onProgress(message);
    },
    onManualCodeInput: () => {
      opts.onAwaitingCode();
      return new Promise<string>((resolve) => {
        resolveManualCode = resolve;
      });
    },
    // `OAuthLoginCallbacks.onPrompt` is REQUIRED by `pi-ai`'s type. A headless
    // dashboard cannot satisfy an arbitrary interactive prompt: surface the
    // prompt text as a progress line so the SPA shows it, then reject — a
    // genuinely interactive prompt that is not the manual-code path cannot be
    // answered headlessly, and rejecting makes `login()` reject, which the
    // route surfaces as a clean `oauth.error`. The manual-code path has its
    // own dedicated callback (`onManualCodeInput`), so `onPrompt` rejecting
    // does not break the headless code-paste flow.
    onPrompt: (prompt) => {
      opts.onProgress(prompt.message);
      return Promise.reject(
        new Error(
          `OAuth provider requested an interactive prompt that cannot be ` +
            `answered headlessly: ${prompt.message}`,
        ),
      );
    },
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  };

  // Kick off `pi-ai`'s `login()` WITHOUT awaiting — the flow is long-running
  // (the browser round-trip). `onComplete` / `onError` fire as it settles.
  void (async () => {
    try {
      const credentials = await oauthProvider.login(callbacks);
      // A throw from `onComplete` itself (e.g. the route's keychain write
      // rejecting) is caught here and surfaced via `onError`.
      await opts.onComplete(credentials);
    } catch (err) {
      opts.onError('oauth_login_failed', err instanceof Error ? err.message : String(err));
    }
  })();

  return {
    submitManualCode: (code: string) => {
      const resolve = resolveManualCode;
      resolveManualCode = null;
      resolve?.(code);
    },
  };
}
