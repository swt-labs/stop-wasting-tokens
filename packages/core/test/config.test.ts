import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, parseConfig } from '../src/config/Config.js';
import { ConfigError } from '../src/errors/SwtError.js';

describe('SwtConfig', () => {
  it('applies defaults when nothing is provided', () => {
    expect(DEFAULT_CONFIG.effort).toBe('balanced');
    expect(DEFAULT_CONFIG.autonomy).toBe('standard');
    expect(DEFAULT_CONFIG.verification_tier).toBe('standard');
    expect(DEFAULT_CONFIG.model_profile).toBe('quality');
    expect(DEFAULT_CONFIG.prefer_teams).toBe('auto');
    expect(DEFAULT_CONFIG.auto_uat).toBe(false);
    expect(DEFAULT_CONFIG.planning_tracking).toBe('manual');
    expect(DEFAULT_CONFIG.auto_push).toBe('never');
  });

  it('accepts a partial override', () => {
    const cfg = parseConfig({ effort: 'thorough', autonomy: 'pure-vibe' });
    expect(cfg.effort).toBe('thorough');
    expect(cfg.autonomy).toBe('pure-vibe');
    expect(cfg.verification_tier).toBe('standard');
  });

  it('rejects an unknown effort tier', () => {
    expect(() => parseConfig({ effort: 'extreme' })).toThrow(ConfigError);
  });

  it('rejects an unknown autonomy tier', () => {
    expect(() => parseConfig({ autonomy: 'aggressive' })).toThrow(ConfigError);
  });

  it('respects per-agent max-turn overrides', () => {
    const cfg = parseConfig({ agent_max_turns: { dev: 100, qa: 30 } });
    expect(cfg.agent_max_turns.dev).toBe(100);
    expect(cfg.agent_max_turns.qa).toBe(30);
  });
});

describe('SwtConfig — settings-v2 fields', () => {
  it('new boolean fields default correctly', () => {
    expect(DEFAULT_CONFIG.auto_commit).toBe(true);
    expect(DEFAULT_CONFIG.skill_suggestions).toBe(true);
    expect(DEFAULT_CONFIG.auto_install_skills).toBe(false);
    expect(DEFAULT_CONFIG.discovery_questions).toBe(true);
    expect(DEFAULT_CONFIG.context_compiler).toBe(true);
    expect(DEFAULT_CONFIG.branch_per_milestone).toBe(false);
    expect(DEFAULT_CONFIG.rolling_summary).toBe(false);
    expect(DEFAULT_CONFIG.require_phase_discussion).toBe(false);
  });

  it('new enum fields default correctly', () => {
    expect(DEFAULT_CONFIG.discussion_mode).toBe('questions');
    expect(DEFAULT_CONFIG.visual_format).toBe('unicode');
    expect(DEFAULT_CONFIG.caveman_style).toBe('none');
    expect(DEFAULT_CONFIG.active_profile).toBe('default');
  });

  it('new numeric/array/record fields default correctly', () => {
    expect(DEFAULT_CONFIG.max_tasks_per_plan).toBe(5);
    expect(DEFAULT_CONFIG.max_uat_remediation_rounds).toBe(false);
    expect(DEFAULT_CONFIG.qa_skip_agents).toEqual(['docs']);
    expect(DEFAULT_CONFIG.custom_profiles).toEqual({});
  });

  it('discussion_mode accepts questions/assumptions/auto and rejects unknown', () => {
    expect(() => parseConfig({ discussion_mode: 'questions' })).not.toThrow();
    expect(() => parseConfig({ discussion_mode: 'assumptions' })).not.toThrow();
    expect(() => parseConfig({ discussion_mode: 'auto' })).not.toThrow();
    expect(() => parseConfig({ discussion_mode: 'invalid' })).toThrow(ConfigError);
  });

  it('visual_format accepts unicode/ascii and rejects unknown', () => {
    expect(() => parseConfig({ visual_format: 'unicode' })).not.toThrow();
    expect(() => parseConfig({ visual_format: 'ascii' })).not.toThrow();
    expect(() => parseConfig({ visual_format: 'raw' })).toThrow(ConfigError);
  });

  it('caveman_style accepts none/aggressive/extreme and rejects unknown', () => {
    expect(() => parseConfig({ caveman_style: 'none' })).not.toThrow();
    expect(() => parseConfig({ caveman_style: 'aggressive' })).not.toThrow();
    expect(() => parseConfig({ caveman_style: 'extreme' })).not.toThrow();
    expect(() => parseConfig({ caveman_style: 'mild' })).toThrow(ConfigError);
  });

  it('qa_skip_agents defaults to ["docs"] and accepts custom arrays', () => {
    expect(DEFAULT_CONFIG.qa_skip_agents).toEqual(['docs']);
    const cfg = parseConfig({ qa_skip_agents: ['docs', 'scout'] });
    expect(cfg.qa_skip_agents).toEqual(['docs', 'scout']);
  });

  it('parses a minimal empty config with all new fields defaulted', () => {
    const cfg = parseConfig({});
    expect(cfg.auto_commit).toBe(true);
    expect(cfg.skill_suggestions).toBe(true);
    expect(cfg.discussion_mode).toBe('questions');
    expect(cfg.visual_format).toBe('unicode');
    expect(cfg.max_tasks_per_plan).toBe(5);
    expect(cfg.active_profile).toBe('default');
    expect(cfg.custom_profiles).toEqual({});
    // All 16 new fields (15 + custom_profiles) are populated — no undefined.
    const keys = [
      'auto_commit',
      'skill_suggestions',
      'auto_install_skills',
      'discovery_questions',
      'discussion_mode',
      'context_compiler',
      'visual_format',
      'max_tasks_per_plan',
      'branch_per_milestone',
      'active_profile',
      'qa_skip_agents',
      'rolling_summary',
      'require_phase_discussion',
      'max_uat_remediation_rounds',
      'caveman_style',
      'custom_profiles',
    ];
    for (const k of keys) {
      expect((cfg as unknown as Record<string, unknown>)[k]).not.toBeUndefined();
    }
  });

  it('custom_profiles accepts a valid custom profile entry', () => {
    const cfg = parseConfig({
      custom_profiles: {
        my_profile: {
          id: 'my_profile',
          name: 'Mine',
          description: 'Test profile',
          values: { effort: 'turbo' },
        },
      },
    });
    expect(cfg.custom_profiles.my_profile.name).toBe('Mine');
    expect(cfg.custom_profiles.my_profile.description).toBe('Test profile');
    expect(cfg.custom_profiles.my_profile.values.effort).toBe('turbo');
  });

  it('max_uat_remediation_rounds accepts false (unlimited)', () => {
    const cfg = parseConfig({ max_uat_remediation_rounds: false });
    expect(cfg.max_uat_remediation_rounds).toBe(false);
  });

  it('max_uat_remediation_rounds accepts positive integers', () => {
    const cfg = parseConfig({ max_uat_remediation_rounds: 3 });
    expect(cfg.max_uat_remediation_rounds).toBe(3);
  });

  it('max_uat_remediation_rounds rejects zero and negative integers', () => {
    expect(() => parseConfig({ max_uat_remediation_rounds: 0 })).toThrow(ConfigError);
    expect(() => parseConfig({ max_uat_remediation_rounds: -1 })).toThrow(ConfigError);
  });

  it('active_profile accepts open string IDs for future custom profiles', () => {
    // Load-bearing CONTEXT-AMENDMENT invariant: active_profile is z.string(),
    // NOT z.enum([...]). Future custom_profiles entries must be selectable.
    const cfg = parseConfig({ active_profile: 'my_custom_id' });
    expect(cfg.active_profile).toBe('my_custom_id');
  });
});

describe('SwtConfig — strip-unknown invariant (alpha.43, keychain_improvements.md §3.2)', () => {
  // The strip-unknown behavior of `ConfigSchema.parse` is what made the
  // alpha.38 bug class possible: any top-level key not declared in
  // ConfigSchema gets silently dropped on parse(). The fix landed in
  // alpha.40's `updateConfigFile` helper (preserves sibling-owned keys
  // by reading the on-disk file first and applying the mutator on top),
  // not by changing the schema itself — strip-unknown remains the right
  // shape for the CLI/dashboard preference surface.
  //
  // These assertions make the silent contract explicit. They document
  // (and lock in) that ConfigSchema DOES strip — so any future config-
  // writing route knows it must use `updateConfigFile` or another
  // explicit preserve-then-merge dance.

  it('strips unknown top-level keys on parse (the load-bearing default)', () => {
    const result = parseConfig({
      effort: 'fast',
      auth: { anthropic: { mode: 'oauth' } },
      providers: { strategy: { kind: 'pinned', provider: 'anthropic' } },
      totally_made_up_key: 'should be dropped',
    });
    // The defined field survived…
    expect(result.effort).toBe('fast');
    // …but the credential-adjacent siblings (owned by provider-auth*.ts)
    // and the made-up key are stripped. Writers MUST NOT round-trip the
    // parsed result back to disk verbatim — see update-config-file.ts.
    expect(result).not.toHaveProperty('auth');
    expect(result).not.toHaveProperty('providers');
    expect(result).not.toHaveProperty('totally_made_up_key');
  });

  it('strip applies even when the stripped value is well-formed', () => {
    // Sanity: it's not "strips invalid auth, accepts valid auth". It's
    // strips ANY undeclared key, regardless of shape.
    const result = parseConfig({
      auth: { anthropic: { mode: 'api_key', credentialRef: 'swt:anthropic:api_key' } },
    });
    expect(result).not.toHaveProperty('auth');
  });
});
