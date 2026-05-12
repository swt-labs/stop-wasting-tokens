/**
 * Public barrel for runtime extensions.
 *
 * Consumers import `from '@swt-labs/runtime/extensions'` to wire the
 * Pi-side extension factories at session-creation time. Each named
 * extension exports a factory builder (`buildXxxExtension(opts)`) plus a
 * preconfigured default for the common case.
 */

export {
  buildResultProtocolExtension,
  enrichWithFileMetadata,
  getTaskIdFromCtx,
  SwtReportResultParamsSchema,
  TaskResultSchema,
  type SwtReportResultParams,
  type ResultProtocolExtensionOptions,
} from './result-protocol.js';
export { default as resultProtocolExtension } from './result-protocol.js';
export {
  buildJournalExtension,
  FileJournalSink,
  MemoryJournalSink,
  type JournalExtensionOptions,
} from './journal.js';
export { default as journalExtension } from './journal.js';
export { buildAllProviderConfigs } from './provider-overrides.js';
export { default as providerOverridesExtension } from './provider-overrides.js';
export type {
  PiExtensionAPI,
  PiExtensionContext,
  PiToolDefinition,
  PiToolExecuteResult,
  PiSessionEntry,
  PiEventName,
  JournalSink,
} from './pi-types.js';
