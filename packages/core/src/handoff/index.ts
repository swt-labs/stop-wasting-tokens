export * from './envelope.js';
export * from './scout.js';
export * from './architect.js';
export * from './lead.js';
export * from './dev.js';
export * from './qa.js';

import type { ScoutHandoff } from './scout.js';
import type { ArchitectHandoff } from './architect.js';
import type { LeadHandoff } from './lead.js';
import type { DevHandoff } from './dev.js';
import type { QaHandoff } from './qa.js';

/**
 * Discriminated union of every concrete handoff type. Routers narrow on
 * `kind` to handle each shape.
 */
export type SwtHandoff =
  | ScoutHandoff
  | ArchitectHandoff
  | LeadHandoff
  | DevHandoff
  | QaHandoff;
