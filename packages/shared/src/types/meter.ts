/**
 * Token meter contract. Migrated from `runtime/src/meter-types.ts` in PR-04.
 *
 * PR-07 (Plan 01-02) ships the concrete `createTokenMeter()` implementation;
 * shared/ just declares the interface so `SwtSessionOptions.meter` and
 * dashboard panels can typecheck against the eventual impl.
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
