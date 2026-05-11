/**
 * Token meter contract — forward declaration only. PR-07 (Plan 01-02) ships
 * the concrete `createTokenMeter()` implementation; PR-02 just needs the
 * interface so `SwtSessionOptions.meter` can typecheck against the eventual
 * implementation.
 *
 * Pi emits per-turn usage via the `turn_end` event with `AgentMessage.usage`;
 * the meter normalises across providers (Anthropic native fields vs OpenAI
 * fields vs OpenRouter passthrough) into a single `MeterRecord` shape.
 */

export interface MeterRecord {
  readonly timestamp: string;
  readonly milestone: string;
  readonly phase: string;
  readonly task_id: string;
  readonly role: string;
  readonly tier: string;
  readonly provider: string;
  readonly model: string;
  readonly turn: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cost_usd: number;
}

export interface MeterSnapshot {
  readonly totals: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly cost_usd: number;
  };
  readonly records: readonly MeterRecord[];
}

export interface MeterUpdate {
  readonly type: 'METER_UPDATED';
  readonly record: MeterRecord;
}

export interface TokenMeter {
  record(record: Omit<MeterRecord, 'cost_usd'>, costUsd: number): void;
  snapshot(): MeterSnapshot;
  subscribe(listener: (event: MeterUpdate) => void): () => void;
}
