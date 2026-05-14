/**
 * Plan 03-01 T4 — `<CommandsSection>` coverage.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see
 * `provider-auth-panel.test.ts` / `options-menu.test.ts` /
 * `settings-section.test.ts` for the same constraint). To keep this plan's
 * test deliverable shippable without a workspace dep bump, the component's
 * load-bearing behaviour is factored into PURE exported helpers —
 * `classifyVerbAction`, `groupVerbsByCategory`, `summarizeCommandRun` —
 * which are unit-tested directly here, plus a smoke test that the
 * `CommandsSection` export is a callable Solid component.
 *
 * Coverage maps to the plan's `commands-section.test.ts` truth bullet:
 *   (1) classifyVerbAction — the R2 per-verb decision incl. the hard-rule
 *       invariant + the `dashboard_safe`-wins precedence guard.
 *   (2) groupVerbsByCategory — category order, omit-empty, preserve-order,
 *       no-drop.
 *   (3) summarizeCommandRun — ok / empty-stdout / error / null.
 *   (4) component smoke + a compile-time prop-shape assertion.
 */

import { describe, expect, it } from 'vitest';

import type { CommandResponse, CommandSpec } from '@swt-labs/shared';

import {
  CommandsSection,
  classifyVerbAction,
  groupVerbsByCategory,
  summarizeCommandRun,
  type CommandsSectionProps,
} from '../src/client/components/CommandsSection.jsx';

/**
 * A minimal `CommandSpec`-shaped fixture — every field `CommandSpec`
 * requires (`name`, `description`, `usage`, `category`, `dashboard_safe`),
 * matching the shape `command-registry-mirror.ts` produces.
 */
function makeSpec(overrides: Partial<CommandSpec> & { name: string }): CommandSpec {
  return {
    description: `the ${overrides.name} verb`,
    usage: null,
    category: 'core',
    dashboard_safe: false,
    ...overrides,
  };
}

/* (1) classifyVerbAction — the R2 per-verb decision. */
describe('classifyVerbAction', () => {
  it("classifies a dashboard_safe core verb as 'safe-dispatch'", () => {
    const spec = makeSpec({ name: 'doctor', category: 'core', dashboard_safe: true });
    expect(classifyVerbAction(spec)).toBe('safe-dispatch');
  });

  it("classifies a dashboard_safe verb that is category:'stub' as 'safe-dispatch' — dashboard_safe wins the precedence", () => {
    // `qa` is `category:'stub'` in the registry mirror BUT `dashboard_safe:true`
    // via the allowlist — `dashboard_safe` is checked FIRST, so it must NOT
    // fall through to `'disabled-stub'`.
    const spec = makeSpec({ name: 'qa', category: 'stub', dashboard_safe: true });
    expect(classifyVerbAction(spec)).toBe('safe-dispatch');
  });

  it("classifies `vibe` as 'cook-start'", () => {
    const spec = makeSpec({ name: 'vibe', category: 'interactive', dashboard_safe: false });
    expect(classifyVerbAction(spec)).toBe('cook-start');
  });

  it("classifies `watch` (interactive, not vibe) as 'disabled-interactive'", () => {
    const spec = makeSpec({ name: 'watch', category: 'interactive', dashboard_safe: false });
    expect(classifyVerbAction(spec)).toBe('disabled-interactive');
  });

  it("classifies `dashboard` (interactive, not vibe) as 'disabled-interactive'", () => {
    const spec = makeSpec({ name: 'dashboard', category: 'interactive', dashboard_safe: false });
    expect(classifyVerbAction(spec)).toBe('disabled-interactive');
  });

  it("classifies a stub verb as 'disabled-stub'", () => {
    const spec = makeSpec({ name: 'plan', category: 'stub', dashboard_safe: false });
    expect(classifyVerbAction(spec)).toBe('disabled-stub');
  });

  it("classifies a core verb that is NOT dashboard_safe and not vibe as 'disabled-stub' — the catch-all arm", () => {
    // `config` is `category:'core'` but NOT on the allowlist → `rejected_unknown`
    // by `/api/command` → must render disabled.
    const spec = makeSpec({
      name: 'config',
      usage: '[show|get <key>|set <key> <value>]',
      category: 'core',
      dashboard_safe: false,
    });
    expect(classifyVerbAction(spec)).toBe('disabled-stub');
  });

  it('R2 HARD-RULE invariant — no dashboard_safe:false && name!==vibe spec ever one-click-dispatches', () => {
    const sample: CommandSpec[] = [
      makeSpec({ name: 'doctor', category: 'core', dashboard_safe: true }),
      makeSpec({ name: 'qa', category: 'stub', dashboard_safe: true }),
      makeSpec({ name: 'verify', category: 'stub', dashboard_safe: true }),
      makeSpec({ name: 'vibe', category: 'interactive', dashboard_safe: false }),
      makeSpec({ name: 'watch', category: 'interactive', dashboard_safe: false }),
      makeSpec({ name: 'dashboard', category: 'interactive', dashboard_safe: false }),
      makeSpec({ name: 'plan', category: 'stub', dashboard_safe: false }),
      makeSpec({ name: 'config', category: 'core', dashboard_safe: false }),
    ];
    for (const spec of sample) {
      const action = classifyVerbAction(spec);
      // Every 'safe-dispatch' spec is genuinely dashboard_safe.
      if (action === 'safe-dispatch') {
        expect(spec.dashboard_safe).toBe(true);
      }
      // The ONLY 'cook-start' spec is `vibe`.
      if (action === 'cook-start') {
        expect(spec.name).toBe('vibe');
      }
      // No `dashboard_safe:false && name!=='vibe'` spec ever one-click-dispatches.
      if (spec.dashboard_safe === false && spec.name !== 'vibe') {
        expect(action).not.toBe('safe-dispatch');
        expect(action).not.toBe('cook-start');
      }
    }
  });
});

/* (2) groupVerbsByCategory — stable display order, omit-empty, no-drop. */
describe('groupVerbsByCategory', () => {
  it("orders groups core, interactive, stub regardless of input order", () => {
    const verbs: CommandSpec[] = [
      makeSpec({ name: 'plan', category: 'stub' }),
      makeSpec({ name: 'doctor', category: 'core' }),
      makeSpec({ name: 'watch', category: 'interactive' }),
      makeSpec({ name: 'status', category: 'core' }),
    ];
    const groups = groupVerbsByCategory(verbs);
    expect(groups.map((g) => g.category)).toEqual(['core', 'interactive', 'stub']);
  });

  it('omits empty categories — an all-core array yields exactly one group', () => {
    const verbs: CommandSpec[] = [
      makeSpec({ name: 'doctor', category: 'core' }),
      makeSpec({ name: 'status', category: 'core' }),
    ];
    const groups = groupVerbsByCategory(verbs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe('core');
  });

  it('preserves verb order within a group', () => {
    const a = makeSpec({ name: 'aaa', category: 'core' });
    const b = makeSpec({ name: 'bbb', category: 'core' });
    const groups = groupVerbsByCategory([a, b]);
    expect(groups[0]?.verbs.map((v) => v.name)).toEqual(['aaa', 'bbb']);
  });

  it('drops no verb — the flattened union equals the input set', () => {
    const verbs: CommandSpec[] = [
      makeSpec({ name: 'plan', category: 'stub' }),
      makeSpec({ name: 'doctor', category: 'core' }),
      makeSpec({ name: 'watch', category: 'interactive' }),
      makeSpec({ name: 'status', category: 'core' }),
      makeSpec({ name: 'qa', category: 'stub' }),
    ];
    const groups = groupVerbsByCategory(verbs);
    const flattened = groups.flatMap((g) => g.verbs);
    expect(flattened).toHaveLength(verbs.length);
    expect(new Set(flattened.map((v) => v.name))).toEqual(new Set(verbs.map((v) => v.name)));
  });
});

/* (3) summarizeCommandRun — the inline-feedback formatter. */
describe('summarizeCommandRun', () => {
  function makeResponse(overrides: Partial<CommandResponse> = {}): CommandResponse {
    return {
      ok: true,
      exit_code: 0,
      stdout: '',
      stderr: '',
      duration_ms: 5,
      routing_decision: 'literal',
      verb: 'doctor',
      ...overrides,
    };
  }

  it('summarizes a successful run with the first non-empty stdout line', () => {
    const fb = summarizeCommandRun(
      'doctor',
      makeResponse({ ok: true, exit_code: 0, stdout: 'all good\n', verb: 'doctor' }),
    );
    expect(fb.ok).toBe(true);
    expect(fb.verb).toBe('doctor');
    expect(fb.summary).toContain('doctor');
    expect(fb.summary).toContain('all good');
  });

  it("summarizes a successful run with empty stdout as 'exit 0'", () => {
    const fb = summarizeCommandRun(
      'doctor',
      makeResponse({ ok: true, exit_code: 0, stdout: '', verb: 'doctor' }),
    );
    expect(fb.ok).toBe(true);
    expect(fb.summary).toContain('exit 0');
  });

  it('summarizes a failed run with the first non-empty stderr line', () => {
    const fb = summarizeCommandRun(
      'qa',
      makeResponse({ ok: false, exit_code: 2, stderr: 'failed: boom\n', verb: 'qa' }),
    );
    expect(fb.ok).toBe(false);
    expect(fb.verb).toBe('qa');
    expect(fb.summary).toContain('failed: boom');
  });

  it("summarizes a failed run with empty stderr as 'exit <code>'", () => {
    const fb = summarizeCommandRun(
      'qa',
      makeResponse({ ok: false, exit_code: 2, stderr: '', verb: 'qa' }),
    );
    expect(fb.ok).toBe(false);
    expect(fb.summary).toContain('exit 2');
  });

  it("summarizes a null result (thrown round-trip) as a generic 'command failed'", () => {
    const fb = summarizeCommandRun('help', null);
    expect(fb.ok).toBe(false);
    expect(fb.verb).toBe('help');
    expect(fb.summary).toContain('command failed');
  });
});

/* (4) component smoke + compile-time prop-shape assertion. */
describe('CommandsSection component', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof CommandsSection).toBe('function');
  });

  it('the CommandsSectionProps shape is satisfiable', () => {
    const props: CommandsSectionProps = {
      verbs: [],
      loading: false,
      error: null,
      onRunSafeVerb: async () => null,
      onStartCook: async () => null,
      lastResult: null,
    };
    expect(props.verbs.length).toBe(0);
  });
});
