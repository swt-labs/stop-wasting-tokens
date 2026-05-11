/**
 * Inline runtime type definitions. PR-04 (`@swt-labs/shared`) extracts these
 * into the shared package; `runtime/` will then re-export from there. Kept
 * local for PR-02 to keep this PR self-contained — no chicken-and-egg with
 * shared/ creation, which the plan schedules after runtime/.
 *
 * Once shared lands, this file becomes:
 *   export type { SwtSession, SwtSessionOptions, SwtEvent } from '@swt-labs/shared';
 */
import type { TokenMeter } from './meter-types.js';

/**
 * SWT session — vendor-neutral wrapper over Pi's AgentSession.
 * Concrete implementation in PR-06 (Plan 01-02). PR-02 ships a mock-shape stub.
 */
export interface SwtSession {
  /** Send a prompt to the session and return when the model finishes its turn. */
  prompt(text: string): Promise<void>;
  /** Subscribe to normalised events (SwtEvent). Returns an unsubscribe handle. */
  subscribe(listener: (event: SwtEvent) => void): () => void;
  /** Stable per-session id used for telemetry correlation. */
  readonly sessionId: string;
  /** Tear down the session. Idempotent. */
  dispose(): void;
}

/**
 * Construction-time options for `createSession`. Per Plan 01-01 PR-04 +
 * 01-02 PR-07: the meter is constructor-injected (not attached via a
 * post-construction method) so it's a stable session invariant.
 */
export interface SwtSessionOptions {
  readonly cwd: string;
  /** When true, do not persist a session file; matches Pi's `--no-session` semantics. */
  readonly ephemeral?: boolean;
  /** Optional token meter; required for the cassette-replay assertion in 01-02 PR-07. */
  readonly meter?: TokenMeter;
}

/**
 * Vendor-neutral event union. Pi's 14 raw events get mapped here in events.ts.
 * Plan 01-02 PR-07 extends this with `TASK_TOKEN_USAGE` (Pi `turn_end` payload).
 */
export type SwtEvent =
  | { readonly type: 'AGENT_START'; readonly sessionId: string }
  | { readonly type: 'AGENT_END'; readonly sessionId: string }
  | { readonly type: 'MESSAGE_DELTA'; readonly sessionId: string; readonly text: string }
  | { readonly type: 'TOOL_CALL'; readonly sessionId: string; readonly name: string }
  | { readonly type: 'TOOL_RESULT'; readonly sessionId: string; readonly name: string };
