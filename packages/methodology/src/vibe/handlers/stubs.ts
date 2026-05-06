import { NotImplementedError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';
import { ModeRegistry } from './index.js';

export interface StubSpec {
  readonly kind: VibeRoute['kind'];
  readonly roadmap_pointer: string;
}

const STUB_SPECS: readonly StubSpec[] = [
  { kind: 'init-redirect', roadmap_pointer: 'Phase 9 / Plan 03 (Init redirect helper)' },
  { kind: 'bootstrap', roadmap_pointer: 'Phase 9 / Plan 03 (Bootstrap mode)' },
  { kind: 'scope', roadmap_pointer: 'Phase 9 / Plan 03 (Scope mode)' },
  { kind: 'discuss', roadmap_pointer: 'Phase 9 / Plan 03 (Discussion engine)' },
  { kind: 'plan-and-execute', roadmap_pointer: 'Phase 9 / Plan 04 (Plan + Execute orchestration)' },
  { kind: 'execute', roadmap_pointer: 'Phase 9 / Plan 04 (Execute mode)' },
  { kind: 'verify', roadmap_pointer: 'Phase 9 / Plan 06 (Verify / UAT mode)' },
  { kind: 'qa-remediation', roadmap_pointer: 'Phase 9 / Plan 05 (QA remediation pipeline)' },
  { kind: 'uat-remediation', roadmap_pointer: 'Phase 9 / Plan 05 (UAT remediation pipeline)' },
  { kind: 're-verify', roadmap_pointer: 'Phase 9 / Plan 05 (Re-verify after remediation)' },
  { kind: 'milestone-uat-recovery', roadmap_pointer: 'Phase 9 / Plan 06 (Milestone UAT recovery)' },
  { kind: 'archive', roadmap_pointer: 'Phase 9 / Plan 07 (Archive + audit gate)' },
  { kind: 'all-done', roadmap_pointer: 'Phase 9 / Plan 07 (Archive)' },
];

export function stubHandler(spec: StubSpec): ModeHandler {
  return {
    kind: spec.kind,
    async run(route: VibeRoute, _io: ModeIO): Promise<HandlerResult> {
      throw new NotImplementedError(route.kind, spec.roadmap_pointer);
    },
  };
}

/**
 * Populate every VibeRoute kind with a stub handler. Real handlers replace
 * stubs by re-registering the same kind on a fresh registry.
 */
export function buildStubRegistry(): ModeRegistry {
  const registry = new ModeRegistry();
  for (const spec of STUB_SPECS) {
    registry.register(stubHandler(spec));
  }
  return registry;
}

/**
 * Build a vibe registry where the supplied real handlers win and the stubs
 * fill in everything else.
 */
export function buildVibeRegistry(realHandlers: readonly ModeHandler[] = []): ModeRegistry {
  const registry = new ModeRegistry();
  const realKinds = new Set(realHandlers.map((h) => h.kind));
  for (const handler of realHandlers) {
    registry.register(handler);
  }
  for (const spec of STUB_SPECS) {
    if (!realKinds.has(spec.kind)) {
      registry.register(stubHandler(spec));
    }
  }
  return registry;
}
