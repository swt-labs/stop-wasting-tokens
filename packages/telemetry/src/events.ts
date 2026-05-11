export type EventName =
  | 'cli.command_invoked'
  | 'vibe.phase_started'
  | 'vibe.phase_completed'
  | 'uat.checkpoint'
  | 'uat.remediation_round_started'
  // PR-07 (M1): opt-in telemetry payloads carry aggregate dimensions only,
  // never prompt content (Principle 4 — telemetry is aggregate-only).
  | 'swt.m1.meter.updated'
  | 'swt.m1.cassette.replay_started'
  | 'swt.m1.cassette.replay_complete'
  | 'swt.m1.task_result.parsed';

export interface EventProperties {
  'cli.command_invoked': { command_name: string };
  'vibe.phase_started': { phase: number; mode: 'plan' | 'execute' | 'verify' | 'archive' };
  'vibe.phase_completed': { phase: number; status: 'complete' | 'partial' | 'failed' };
  'uat.checkpoint': { phase: number; result: 'pass' | 'fail' | 'skip' };
  'uat.remediation_round_started': { phase: number; round: number };
  // Aggregate dimensional snapshot; no prompt content, no raw model output.
  'swt.m1.meter.updated': {
    milestone: string;
    phase: string;
    role: string;
    provider: string;
    input_total: number;
    output_total: number;
    cache_read_total: number;
    cache_write_total: number;
    cost_usd_total: number;
  };
  'swt.m1.cassette.replay_started': { cassette_id: string };
  'swt.m1.cassette.replay_complete': { cassette_id: string; delta_tokens: number; passed: boolean };
  'swt.m1.task_result.parsed': { task_id: string; ok: boolean };
}

export const ALLOWED_KEYS: { [K in EventName]: ReadonlyArray<keyof EventProperties[K]> } = {
  'cli.command_invoked': ['command_name'],
  'vibe.phase_started': ['phase', 'mode'],
  'vibe.phase_completed': ['phase', 'status'],
  'uat.checkpoint': ['phase', 'result'],
  'uat.remediation_round_started': ['phase', 'round'],
  'swt.m1.meter.updated': [
    'milestone',
    'phase',
    'role',
    'provider',
    'input_total',
    'output_total',
    'cache_read_total',
    'cache_write_total',
    'cost_usd_total',
  ],
  'swt.m1.cassette.replay_started': ['cassette_id'],
  'swt.m1.cassette.replay_complete': ['cassette_id', 'delta_tokens', 'passed'],
  'swt.m1.task_result.parsed': ['task_id', 'ok'],
};

/**
 * Registry of M1 events with their `since` version and accepted payload
 * keys. Consumers can iterate this for runtime validation ("is this event
 * name registered? what fields are allowed?") without leaking the
 * compile-time `EventName` literal to dynamic call sites.
 *
 * Adding to this registry is the canonical way to introduce a new
 * telemetry event — no separate per-package boilerplate.
 */
export const M1_EVENT_REGISTRY: ReadonlyArray<{
  readonly name: EventName;
  readonly since: string;
  readonly payloadKeys: ReadonlyArray<string>;
}> = [
  {
    name: 'swt.m1.meter.updated',
    since: '3.0.0-alpha.1',
    payloadKeys: [...ALLOWED_KEYS['swt.m1.meter.updated']],
  },
  {
    name: 'swt.m1.cassette.replay_started',
    since: '3.0.0-alpha.1',
    payloadKeys: [...ALLOWED_KEYS['swt.m1.cassette.replay_started']],
  },
  {
    name: 'swt.m1.cassette.replay_complete',
    since: '3.0.0-alpha.1',
    payloadKeys: [...ALLOWED_KEYS['swt.m1.cassette.replay_complete']],
  },
  {
    name: 'swt.m1.task_result.parsed',
    since: '3.0.0-alpha.1',
    payloadKeys: [...ALLOWED_KEYS['swt.m1.task_result.parsed']],
  },
];

export interface TelemetryEvent {
  readonly name: EventName;
  readonly properties: Record<string, unknown>;
  readonly anonymous_id: string;
  readonly at: number;
}
