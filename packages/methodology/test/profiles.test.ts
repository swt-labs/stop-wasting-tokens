import { describe, expect, it } from 'vitest';

import {
  resolveAutonomyProfile,
  resolveEffortProfile,
  resolveVerificationProfile,
  scaleAgentTurns,
} from '../src/profiles/index.js';

describe('effort profile', () => {
  it('thorough includes Scout, Architect, and QA', () => {
    const p = resolveEffortProfile('thorough');
    expect(p.include_scout).toBe(true);
    expect(p.include_architect).toBe(true);
    expect(p.include_qa).toBe(true);
    expect(p.turn_scalar).toBeGreaterThan(1);
  });

  it('turbo skips Scout, Architect, and QA', () => {
    const p = resolveEffortProfile('turbo');
    expect(p.include_scout).toBe(false);
    expect(p.include_architect).toBe(false);
    expect(p.include_qa).toBe(false);
    expect(p.turn_scalar).toBeLessThan(1);
  });

  it('scaleAgentTurns multiplies and rounds', () => {
    const base = {
      orchestrator: 50,
      scout: 15,
      architect: 30,
      lead: 50,
      dev: 75,
      qa: 25,
      debugger: 80,
    };
    const thorough = scaleAgentTurns(base, 'thorough');
    expect(thorough.dev).toBe(Math.round(75 * 1.5));
    const turbo = scaleAgentTurns(base, 'turbo');
    expect(turbo.qa).toBe(Math.round(25 * 0.6));
    expect(turbo.scout).toBeGreaterThanOrEqual(1);
  });
});

describe('autonomy profile', () => {
  it('cautious stops after every stage', () => {
    const p = resolveAutonomyProfile('cautious');
    expect(p.stop_after_plan).toBe(true);
    expect(p.stop_after_execute).toBe(true);
    expect(p.stop_after_qa).toBe(true);
    expect(p.auto_chain_phases).toBe(false);
  });

  it('pure-vibe auto-chains phases without stopping', () => {
    const p = resolveAutonomyProfile('pure-vibe');
    expect(p.stop_after_plan).toBe(false);
    expect(p.stop_after_execute).toBe(false);
    expect(p.stop_after_qa).toBe(false);
    expect(p.auto_chain_phases).toBe(true);
  });
});

describe('verification profile', () => {
  it('quick skips unit and integration tests', () => {
    const p = resolveVerificationProfile('quick');
    expect(p.run_unit_tests).toBe(false);
    expect(p.run_integration_tests).toBe(false);
  });

  it('deep enforces traceability', () => {
    const p = resolveVerificationProfile('deep');
    expect(p.run_integration_tests).toBe(true);
    expect(p.enforce_traceability).toBe(true);
  });
});
