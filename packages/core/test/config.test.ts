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
