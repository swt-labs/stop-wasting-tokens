/**
 * The seven methodology agents plus the orchestrator that drives them.
 *
 * Plan 01-01 T02 adds `'docs'` to close the type gap with `agents/swt-docs.md`
 * (Phase 3 needs to spawn the docs agent; this union is the upstream type
 * that gates `swt:spawnAgent` accepting it).
 */
export type AgentRole =
  | 'orchestrator'
  | 'scout'
  | 'architect'
  | 'lead'
  | 'dev'
  | 'qa'
  | 'debugger'
  | 'docs';

export const AGENT_ROLES: readonly AgentRole[] = [
  'orchestrator',
  'scout',
  'architect',
  'lead',
  'dev',
  'qa',
  'debugger',
  'docs',
] as const;

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && (AGENT_ROLES as readonly string[]).includes(value);
}
