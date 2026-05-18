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
export {
  APPLY_PATCH_TOOL_NAME,
  buildApplyPatchExtension,
  type ApplyPatchFs,
  type BuildApplyPatchExtensionOptions,
} from './apply-patch-tool.js';
export { default as applyPatchExtension } from './apply-patch-tool.js';
export {
  UPDATE_PLAN_TOOL_NAME,
  TOOL_DESCRIPTION as UPDATE_PLAN_TOOL_DESCRIPTION,
  PARAMETERS_JSON_SCHEMA as UPDATE_PLAN_PARAMETERS_JSON_SCHEMA,
  PlanItemArgSchema,
  UpdatePlanArgsSchema,
  buildUpdatePlanExtension,
  type PlanItemArg,
  type UpdatePlanArgs,
  type BuildUpdatePlanExtensionOptions,
} from './update-plan-tool.js';
export { default as updatePlanExtension } from './update-plan-tool.js';
export {
  parseApplyPatch,
  type ApplyPatchResult,
  type FileOp,
  type Hunk,
  type ChangeLine,
} from './apply-patch-parser.js';
export type {
  PiExtensionAPI,
  PiExtensionContext,
  PiToolDefinition,
  PiToolExecuteResult,
  PiSessionEntry,
  PiEventName,
  JournalSink,
} from './pi-types.js';
