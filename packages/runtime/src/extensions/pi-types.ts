/**
 * Local structural shapes for Pi's `ExtensionAPI` + `ExtensionContext`.
 *
 * Why a local mirror instead of `import { ExtensionAPI } from
 * '@earendil-works/pi-coding-agent'`?
 *
 * Pi 0.74 is marked alpha; the upstream type definitions have shifted at
 * least twice across patch releases. Pinning to a structural shape that
 * captures only the methods PR-09's extensions actually use (`registerTool`,
 * `on`, `appendEntry`) keeps the runtime compiling across Pi 0.74.x patch
 * bumps without requiring a synchronised dependency upgrade. When Pi
 * publishes a 1.0 stable type surface, this file collapses to a thin
 * re-export of the upstream types.
 *
 * Per ADR-002: `appendEntry` is on `ExtensionAPI` (closure-captured), NOT
 * on `ExtensionContext`. The local shape encodes that invariant so a future
 * contributor who mistakenly types `ctx.appendEntry(...)` gets a TS error.
 */

import type { SwtEvent } from '@swt-labs/shared';

export interface PiSessionEntry {
  readonly type: string;
  readonly customType?: string;
  readonly data?: unknown;
}

export interface PiExtensionContext {
  readonly cwd: string;
  readonly sessionManager: {
    getEntries(): ReadonlyArray<PiSessionEntry>;
  };
  // INTENTIONALLY no `appendEntry` here. Per ADR-002 / TDD2 §5.4, the
  // append-entry primitive lives on `ExtensionAPI` (closure-captured).
}

export interface PiToolExecuteResult {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  readonly details?: unknown;
  readonly terminate?: boolean;
}

export interface PiToolDefinition<TParams = unknown> {
  readonly name: string;
  readonly label?: string;
  readonly description: string;
  readonly promptSnippet?: string;
  readonly promptGuidelines?: ReadonlyArray<string>;
  /**
   * Pi's `registerTool` accepts either a JSON Schema literal or a runtime
   * validator object. We pass a JSON-Schema-shaped record so the on-disk
   * tool definition is canonical regardless of which Pi shape ships in
   * 1.0. The schema is produced from a Zod `.parse(...)` validator at the
   * boundary inside `execute`.
   */
  readonly parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: TParams,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: unknown) => void) | undefined,
    ctx: PiExtensionContext,
  ): Promise<PiToolExecuteResult>;
}

export type PiEventName = 'agent_start' | 'agent_end' | 'turn_start' | 'turn_end' | string;

export interface PiExtensionAPI {
  registerTool<TParams = unknown>(def: PiToolDefinition<TParams>): void;
  on(event: PiEventName, handler: (event: unknown, ctx: PiExtensionContext) => void): void;
  /**
   * THE closure-captured `appendEntry` (ADR-002). When `customType` is set,
   * Pi stores the entry as `type: 'custom'` with the supplied `customType`
   * tag so harvesters can discriminate.
   */
  appendEntry(customType: string, data: unknown): void;
}

/**
 * SwtEvent-aware journal sink — used by `journal.ts` to mirror runtime
 * events into a per-session JSONL file. The journal extension converts
 * Pi events into SwtEvents (via `mapPiEvent`) and writes them through
 * this sink. Kept separate so tests can inject a memory sink.
 */
export interface JournalSink {
  write(event: SwtEvent): void;
  close(): Promise<void> | void;
}
