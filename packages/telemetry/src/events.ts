export type EventName =
  | 'cli.command_invoked'
  | 'vibe.phase_started'
  | 'vibe.phase_completed'
  | 'uat.checkpoint'
  | 'uat.remediation_round_started';

export interface EventProperties {
  'cli.command_invoked': { command_name: string };
  'vibe.phase_started': { phase: number; mode: 'plan' | 'execute' | 'verify' | 'archive' };
  'vibe.phase_completed': { phase: number; status: 'complete' | 'partial' | 'failed' };
  'uat.checkpoint': { phase: number; result: 'pass' | 'fail' | 'skip' };
  'uat.remediation_round_started': { phase: number; round: number };
}

export const ALLOWED_KEYS: { [K in EventName]: ReadonlyArray<keyof EventProperties[K]> } = {
  'cli.command_invoked': ['command_name'],
  'vibe.phase_started': ['phase', 'mode'],
  'vibe.phase_completed': ['phase', 'status'],
  'uat.checkpoint': ['phase', 'result'],
  'uat.remediation_round_started': ['phase', 'round'],
};

export interface TelemetryEvent {
  readonly name: EventName;
  readonly properties: Record<string, unknown>;
  readonly anonymous_id: string;
  readonly at: number;
}
