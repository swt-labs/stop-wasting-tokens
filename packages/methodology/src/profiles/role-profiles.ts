/**
 * SDLC role profiles per TDD2 §10.1. Each profile declares the canonical
 * default tier, tool-subset, session mode, and thinking level for a role.
 *
 * The orchestration dispatcher consumes these via `role-router.toolsForRole`
 * (TDD2 §10.4) and `prompt-builder.buildPrompt`. Project-level overrides
 * apply per the 4-level precedence in TDD2 §10.2 (built-in → user config →
 * project config → task override) — this module ships the built-in defaults.
 *
 * Prompts ship as sibling `.prompt.md` files in the same directory. The
 * profile carries the relative path; consumers resolve it via
 * `new URL(profile.promptPath, import.meta.url)`.
 */

import type { ThinkingLevel } from '@swt-labs/core';

export type SDLCRole = 'scout' | 'architect' | 'lead' | 'dev' | 'qa' | 'debugger';

export type Tier = 'cheap-fast' | 'balanced' | 'quality' | 'reasoning';

export type ToolSubset = 'readonly' | 'qa-bash' | 'coding';

export type SessionMode = 'ephemeral' | 'persistent';

export interface RoleProfile {
  readonly role: SDLCRole;
  readonly defaultTier: Tier;
  readonly toolSubset: ToolSubset;
  readonly sessionMode: SessionMode;
  readonly defaultThinkingLevel: ThinkingLevel;
  /** Sibling .prompt.md filename — resolved relative to this module's URL. */
  readonly promptPath: string;
}

export const SCOUT_PROFILE: RoleProfile = {
  role: 'scout',
  defaultTier: 'cheap-fast',
  toolSubset: 'readonly',
  sessionMode: 'ephemeral',
  defaultThinkingLevel: 'off',
  promptPath: './scout.prompt.md',
};

export const ARCHITECT_PROFILE: RoleProfile = {
  role: 'architect',
  defaultTier: 'quality',
  toolSubset: 'readonly',
  sessionMode: 'ephemeral',
  defaultThinkingLevel: 'medium',
  promptPath: './architect.prompt.md',
};

export const LEAD_PROFILE: RoleProfile = {
  role: 'lead',
  defaultTier: 'balanced',
  toolSubset: 'coding',
  sessionMode: 'persistent',
  defaultThinkingLevel: 'low',
  promptPath: './lead.prompt.md',
};

export const DEV_PROFILE: RoleProfile = {
  role: 'dev',
  defaultTier: 'balanced',
  toolSubset: 'coding',
  sessionMode: 'ephemeral',
  defaultThinkingLevel: 'low',
  promptPath: './dev.prompt.md',
};

export const QA_PROFILE: RoleProfile = {
  role: 'qa',
  defaultTier: 'balanced',
  toolSubset: 'qa-bash',
  sessionMode: 'ephemeral',
  defaultThinkingLevel: 'low',
  promptPath: './qa.prompt.md',
};

export const DEBUGGER_PROFILE: RoleProfile = {
  role: 'debugger',
  defaultTier: 'reasoning',
  toolSubset: 'coding',
  sessionMode: 'persistent',
  defaultThinkingLevel: 'xhigh',
  promptPath: './debugger.prompt.md',
};

export const ROLE_PROFILES: Readonly<Record<SDLCRole, RoleProfile>> = {
  scout: SCOUT_PROFILE,
  architect: ARCHITECT_PROFILE,
  lead: LEAD_PROFILE,
  dev: DEV_PROFILE,
  qa: QA_PROFILE,
  debugger: DEBUGGER_PROFILE,
};

export const SDLC_ROLES: ReadonlyArray<SDLCRole> = [
  'scout',
  'architect',
  'lead',
  'dev',
  'qa',
  'debugger',
];

export function isSDLCRole(value: unknown): value is SDLCRole {
  return typeof value === 'string' && (SDLC_ROLES as readonly string[]).includes(value);
}

export function getRoleProfile(role: SDLCRole): RoleProfile {
  return ROLE_PROFILES[role];
}
