import type { TokenMeter } from './meter.js';

/**
 * SWT session — vendor-neutral wrapper over Pi's `AgentSession`.
 *
 * Migrated from `runtime/src/types.ts` in PR-04. The shape is locked in here
 * so methodology / orchestration / dashboard can reason about sessions
 * without importing `@earendil-works/pi-coding-agent` (Principle 1 §4.3).
 *
 * Concrete implementation lives in `runtime/src/session.ts`. PR-06 swaps the
 * stub body for a real `createAgentSession()` call.
 */
export interface SwtSession {
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: SwtEvent) => void): () => void;
  readonly sessionId: string;
  dispose(): void;
}

/**
 * Construction-time options for `createSession`. The meter is constructor-
 * injected (not attached via a post-construction method) — locked in at
 * Plan 01-01 PR-04 review.
 */
export interface SwtSessionOptions {
  readonly cwd: string;
  readonly ephemeral?: boolean;
  readonly meter?: TokenMeter;
}

/**
 * Vendor-neutral event union. Pi's 14 raw events get mapped into this in
 * `runtime/src/events.ts`. PR-07 adds `TASK_TOKEN_USAGE` (Pi `turn_end`).
 */
export type SwtEvent =
  | { readonly type: 'AGENT_START'; readonly sessionId: string }
  | { readonly type: 'AGENT_END'; readonly sessionId: string }
  | { readonly type: 'MESSAGE_DELTA'; readonly sessionId: string; readonly text: string }
  | { readonly type: 'TOOL_CALL'; readonly sessionId: string; readonly name: string }
  | { readonly type: 'TOOL_RESULT'; readonly sessionId: string; readonly name: string };
