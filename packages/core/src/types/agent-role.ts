/**
 * The six methodology agents plus the orchestrator that drives them.
 */
export type AgentRole =
  | 'orchestrator'
  | 'scout'
  | 'architect'
  | 'lead'
  | 'dev'
  | 'qa'
  | 'debugger';

export const AGENT_ROLES: readonly AgentRole[] = [
  'orchestrator',
  'scout',
  'architect',
  'lead',
  'dev',
  'qa',
  'debugger',
] as const;

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && (AGENT_ROLES as readonly string[]).includes(value);
}
