/**
 * Plan 01-03 (Phase 1) — public hook-dispatcher surface.
 *
 * Task 1 ships the type vocabulary so `config/hooks.json` can be authored
 * against a stable contract. Task 2 wires the implementation in
 * `./dispatcher.js`; this barrel re-exports both halves.
 */

export type {
  HookEvent,
  HookMatcher,
  HookRegistration,
  HookContext,
  HookDecision,
} from './types.js';

export {
  createHookDispatcher,
  loadHookRegistrationsFromConfig,
  type HookDispatcher,
  type HookDispatcherOptions,
  type HookEventBus,
  type HookEventBusEntry,
} from './dispatcher.js';
