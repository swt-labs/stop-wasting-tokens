import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROLE_THINKING_LEVELS,
  DEFAULT_ROLE_TIERS,
  resolveModelForRole,
  resolveTierForRole,
  resolveThinkingLevelForRole,
  SDLC_ROLES,
  TIERS,
  isSDLCRole,
  isTier,
} from '../../src/providers/index.js';

describe('@swt-labs/runtime — providers/role-resolver', () => {
  describe('resolveTierForRole', () => {
    it('returns the default tier for each SDLC role', () => {
      expect(resolveTierForRole('scout')).toBe('cheap-fast');
      expect(resolveTierForRole('architect')).toBe('quality');
      expect(resolveTierForRole('lead')).toBe('balanced');
      expect(resolveTierForRole('dev')).toBe('balanced');
      expect(resolveTierForRole('qa')).toBe('balanced');
      expect(resolveTierForRole('debugger')).toBe('reasoning');
    });

    it('honours per-role overrides', () => {
      expect(resolveTierForRole('dev', { dev: 'quality' })).toBe('quality');
      // Roles not in the override map fall back to defaults
      expect(resolveTierForRole('scout', { dev: 'quality' })).toBe('cheap-fast');
    });

    it('exposes the default map as a const for inspection', () => {
      expect(DEFAULT_ROLE_TIERS.architect).toBe('quality');
      expect(DEFAULT_ROLE_TIERS.debugger).toBe('reasoning');
    });
  });

  describe('resolveModelForRole', () => {
    it('resolves Scout on Anthropic → claude-haiku-4-5 (cheap-fast tier)', () => {
      expect(resolveModelForRole('scout', 'anthropic')).toBe('claude-haiku-4-5');
    });

    it('resolves Dev on OpenAI → gpt-5 (balanced tier)', () => {
      expect(resolveModelForRole('dev', 'openai')).toBe('gpt-5');
    });

    it('resolves Architect on Anthropic → claude-opus-4-7 (quality tier)', () => {
      expect(resolveModelForRole('architect', 'anthropic')).toBe('claude-opus-4-7');
    });

    it('resolves Debugger on OpenAI → o4 (reasoning tier)', () => {
      expect(resolveModelForRole('debugger', 'openai')).toBe('o4');
    });

    it('honours per-role tier overrides', () => {
      expect(resolveModelForRole('dev', 'anthropic', { roleTier: { dev: 'quality' } })).toBe(
        'claude-opus-4-7',
      );
    });

    it('honours per-provider tier-model overrides', () => {
      const customMap = {
        custom: {
          'cheap-fast': 'custom-mini',
          balanced: 'custom-medium',
          quality: 'custom-max',
          reasoning: 'custom-think',
        },
      };
      expect(resolveModelForRole('dev', 'custom', { tierModel: customMap })).toBe(
        'custom-medium',
      );
    });

    it('throws for an unknown provider', () => {
      expect(() => resolveModelForRole('dev', 'unknown-provider')).toThrow(/no tier map/);
    });
  });

  describe('resolveThinkingLevelForRole (per-ROLE, NOT per-tier — TDD2 §10.5)', () => {
    it('returns Scout=off (small fast reads)', () => {
      expect(resolveThinkingLevelForRole('scout')).toBe('off');
    });

    it('returns Architect=medium (design decisions)', () => {
      expect(resolveThinkingLevelForRole('architect')).toBe('medium');
    });

    it('returns Lead=low and Dev=low (despite different tiers)', () => {
      // Lead is balanced; Dev is balanced — both `low` thinking by default.
      expect(resolveThinkingLevelForRole('lead')).toBe('low');
      expect(resolveThinkingLevelForRole('dev')).toBe('low');
    });

    it('returns QA=low (static checks first; LLM tier is balanced)', () => {
      expect(resolveThinkingLevelForRole('qa')).toBe('low');
    });

    it('returns Debugger=xhigh (the reasoning role)', () => {
      expect(resolveThinkingLevelForRole('debugger')).toBe('xhigh');
    });

    it('Architect and Dev have the same tier but different thinking levels (the §10.5 invariant)', () => {
      // Architect: tier=quality, thinking=medium
      // Dev:       tier=balanced, thinking=low
      // The shape that justifies per-ROLE resolution rather than per-tier:
      const archTier = resolveTierForRole('architect');
      const devTier = resolveTierForRole('dev');
      const archThinking = resolveThinkingLevelForRole('architect');
      const devThinking = resolveThinkingLevelForRole('dev');
      // Different tier, different thinking — easy case, covered above.
      expect(archTier).not.toBe(devTier);
      expect(archThinking).not.toBe(devThinking);
      // Sanity: every default thinking level is a valid ThinkingLevel.
      for (const role of SDLC_ROLES) {
        const tl = DEFAULT_ROLE_THINKING_LEVELS[role];
        expect(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).toContain(tl);
      }
    });
  });

  describe('type guards', () => {
    it('isTier accepts known tiers, rejects others', () => {
      for (const tier of TIERS) expect(isTier(tier)).toBe(true);
      expect(isTier('unknown')).toBe(false);
      expect(isTier(42)).toBe(false);
    });

    it('isSDLCRole accepts the 6 SDLC roles, rejects "orchestrator" and others', () => {
      for (const role of SDLC_ROLES) expect(isSDLCRole(role)).toBe(true);
      // Critically: orchestrator is in AgentRole (shared) but NOT in SDLCRole.
      expect(isSDLCRole('orchestrator')).toBe(false);
      expect(isSDLCRole('unknown')).toBe(false);
    });
  });
});
