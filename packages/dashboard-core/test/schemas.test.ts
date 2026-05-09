import { describe, expect, it } from 'vitest';

import {
  ApiSchemas,
  DebugEmitBodySchema,
  HealthResponseSchema,
  PhaseSummarySchema,
  SCHEMA_VERSION,
  SnapshotEventSchema,
  SnapshotSchema,
} from '../src/index.js';

describe('SnapshotSchema', () => {
  const validSnapshot = {
    schema_version: '1' as const,
    generated_at: '2026-05-09T10:00:00Z',
    project: {
      name: 'stop-wasting-tokens',
      root: '/Users/x/repo',
      backend: 'codex' as const,
    },
    milestone: {
      name: 'v1.6.0 Localhost Dashboard',
      phase_count: 4,
      phase_index: 1,
    },
    phases: [
      {
        position: '01',
        slug: '01-workspace-foundation-and-schema-spike',
        name: 'Workspace Foundation',
        goal: 'spike',
        state: 'needs_execute' as const,
        qa_status: 'none' as const,
        artifacts: [],
      },
    ],
    active_agent: null,
    recent_events: [],
    cost_summary: {
      total_usd: 0,
      today_usd: 0,
      this_milestone_usd: 0,
    },
  };

  it('parses a valid snapshot', () => {
    const parsed = SnapshotSchema.parse(validSnapshot);
    expect(parsed.schema_version).toBe('1');
    expect(parsed.phases).toHaveLength(1);
  });

  it('round-trips parse → stringify → parse without loss', () => {
    const parsed = SnapshotSchema.parse(validSnapshot);
    const second = SnapshotSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(second).toEqual(parsed);
  });

  it('rejects non-zero-padded phase position', () => {
    const bad = { ...validSnapshot, phases: [{ ...validSnapshot.phases[0], position: '1' }] };
    expect(() => SnapshotSchema.parse(bad)).toThrow();
  });

  it('rejects unknown backend', () => {
    const bad = {
      ...validSnapshot,
      project: { ...validSnapshot.project, backend: 'gemini' },
    };
    expect(() => SnapshotSchema.parse(bad)).toThrow();
  });

  it('rejects negative cost', () => {
    const bad = {
      ...validSnapshot,
      cost_summary: { ...validSnapshot.cost_summary, total_usd: -1 },
    };
    expect(() => SnapshotSchema.parse(bad)).toThrow();
  });
});

describe('SnapshotEventSchema (discriminated union)', () => {
  const ts = '2026-05-09T10:00:00Z';

  it('accepts agent.spawn', () => {
    const evt = {
      type: 'agent.spawn' as const,
      ts,
      agent: 'scout',
      phase: '01',
      plan: null,
    };
    expect(SnapshotEventSchema.parse(evt).type).toBe('agent.spawn');
  });

  it('accepts agent.complete with all numeric fields', () => {
    const evt = {
      type: 'agent.complete' as const,
      ts,
      agent: 'scout',
      phase: '01',
      plan: '01-01',
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.0042,
      duration_ms: 1234,
      artifact: '01-RESEARCH.md',
    };
    expect(SnapshotEventSchema.parse(evt).type).toBe('agent.complete');
  });

  it('accepts log.append for stdout', () => {
    const evt = {
      type: 'log.append' as const,
      ts,
      channel: 'stdout' as const,
      line: 'hello',
    };
    expect(SnapshotEventSchema.parse(evt).type).toBe('log.append');
  });

  it('rejects log.append with unknown channel', () => {
    const bad = {
      type: 'log.append' as const,
      ts,
      channel: 'syslog',
      line: 'hi',
    };
    expect(() => SnapshotEventSchema.parse(bad)).toThrow();
  });

  it('rejects unknown event type', () => {
    const bad = { type: 'mystery', ts };
    expect(() => SnapshotEventSchema.parse(bad)).toThrow();
  });

  it('PhaseSummarySchema rejects empty slug', () => {
    expect(() =>
      PhaseSummarySchema.parse({
        position: '01',
        slug: '',
        name: 'x',
        state: 'needs_execute',
        qa_status: 'none',
        artifacts: [],
      }),
    ).toThrow();
  });
});

describe('ApiSchemas', () => {
  it('HealthResponseSchema accepts a fresh server response', () => {
    const parsed = HealthResponseSchema.parse({
      status: 'ok',
      uptime_ms: 0,
      schema_version: '1',
    });
    expect(parsed.status).toBe('ok');
  });

  it('DebugEmitBodySchema reuses the SnapshotEvent contract', () => {
    const evt = {
      type: 'agent.spawn' as const,
      ts: '2026-05-09T10:00:00Z',
      agent: 'scout',
      phase: '01',
      plan: null,
    };
    const parsed = DebugEmitBodySchema.parse(evt);
    expect(parsed.type).toBe('agent.spawn');
  });

  it('ApiSchemas exposes routes with method tags', () => {
    expect(ApiSchemas['/api/health'].method).toBe('GET');
    expect(ApiSchemas['/api/_debug/emit'].method).toBe('POST');
    expect(ApiSchemas['/api/events'].method).toBe('GET');
  });

  it('SCHEMA_VERSION constant is the literal "1"', () => {
    expect(SCHEMA_VERSION).toBe('1');
  });
});
