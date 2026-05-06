import { describe, expect, it } from 'vitest';

import { HandoffError } from '../src/errors/SwtError.js';
import {
  parseArchitectHandoff,
  parseDevHandoff,
  parseLeadHandoff,
  parseQaHandoff,
  parseScoutHandoff,
} from '../src/handoff/index.js';

const baseEnvelope = {
  metadata: { created_at: new Date('2026-05-06T10:00:00Z').toISOString() },
};

describe('handoff schemas', () => {
  it('round-trips a Scout findings envelope', () => {
    const envelope = {
      from: 'scout',
      to: 'lead',
      kind: 'scout-findings',
      payload: {
        goal: 'Investigate the auth flow',
        findings: [
          { topic: 'login', summary: 'uses session cookies', sources: ['src/auth.ts'] },
        ],
      },
      ...baseEnvelope,
    };
    const parsed = parseScoutHandoff(envelope);
    expect(parsed.kind).toBe('scout-findings');
    expect(parsed.payload.findings[0]?.requires_live_validation).toBe(false);
  });

  it('rejects a Scout handoff with no findings', () => {
    const bad = {
      from: 'scout',
      to: 'lead',
      kind: 'scout-findings',
      payload: { goal: 'x', findings: [] },
      ...baseEnvelope,
    };
    expect(() => parseScoutHandoff(bad)).toThrow(HandoffError);
  });

  it('round-trips an Architect design envelope', () => {
    const envelope = {
      from: 'architect',
      to: 'lead',
      kind: 'architect-design',
      payload: {
        goal: 'Pick a queue backend',
        decisions: [
          {
            id: 'D1',
            decision: 'Use Redis Streams',
            rationale: 'Already deployed; matches throughput needs',
          },
        ],
      },
      ...baseEnvelope,
    };
    const parsed = parseArchitectHandoff(envelope);
    expect(parsed.payload.decisions[0]?.id).toBe('D1');
  });

  it('round-trips a Lead plan envelope', () => {
    const envelope = {
      from: 'lead',
      to: 'dev',
      kind: 'lead-plan',
      payload: {
        phase: '03',
        plan: '01',
        title: 'Wire up the queue',
        must_haves: ['queue connects'],
        tasks: [
          {
            id: 'T1',
            description: 'Add Redis client',
            acceptance_criteria: ['ping works'],
          },
        ],
      },
      ...baseEnvelope,
    };
    const parsed = parseLeadHandoff(envelope);
    expect(parsed.payload.tasks[0]?.id).toBe('T1');
  });

  it('rejects a Lead plan with malformed phase number', () => {
    const bad = {
      from: 'lead',
      to: 'dev',
      kind: 'lead-plan',
      payload: {
        phase: '3',
        plan: '01',
        title: 't',
        must_haves: ['x'],
        tasks: [{ id: 'T1', description: 'd', acceptance_criteria: ['a'] }],
      },
      ...baseEnvelope,
    };
    expect(() => parseLeadHandoff(bad)).toThrow(HandoffError);
  });

  it('round-trips a Dev summary envelope', () => {
    const envelope = {
      from: 'dev',
      to: 'qa',
      kind: 'dev-summary',
      payload: {
        phase: '03',
        plan: '01',
        status: 'complete',
        tasks_completed: 3,
        tasks_total: 3,
      },
      ...baseEnvelope,
    };
    const parsed = parseDevHandoff(envelope);
    expect(parsed.payload.deviations).toHaveLength(0);
  });

  it('round-trips a QA verification envelope', () => {
    const envelope = {
      from: 'qa',
      to: 'orchestrator',
      kind: 'qa-verification',
      payload: {
        phase: '03',
        plans_verified: ['01'],
        result: 'pass',
        checks: [
          { id: 'AC1', must_have: 'queue connects', status: 'pass', evidence: 'ping ok' },
        ],
      },
      ...baseEnvelope,
    };
    const parsed = parseQaHandoff(envelope);
    expect(parsed.payload.result).toBe('pass');
  });

  it('rejects an envelope with the wrong discriminator', () => {
    const bad = {
      from: 'dev',
      to: 'qa',
      kind: 'scout-findings',
      payload: { goal: 'x', findings: [{ topic: 't', summary: 's', sources: [] }] },
      ...baseEnvelope,
    };
    expect(() => parseDevHandoff(bad)).toThrow(HandoffError);
  });
});
