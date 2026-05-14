/**
 * `swt_ask_user` Pi custom-tool bridge (Plan 03-02 R2).
 *
 * This is the Phase 3 wiring follow-up referenced by the header of
 * `./ask-user.ts`: a Pi-extension factory that registers a custom tool named
 * `swt_ask_user` on a Pi session. The tool's `execute` delegates to the
 * existing `askUser()` primitive — it does NOT reimplement the dashboard SSE
 * + readline fallback logic; it just calls through.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ORCHESTRATOR-ONLY INVARIANT (READ BEFORE EXTENDING THIS MODULE)
 *
 *   `swt_ask_user` is registered on the ORCHESTRATOR session only. Spawned
 *   roles (dev/qa/scout/lead/architect/debugger/docs) MUST NOT receive this
 *   tool. The invariant is enforced at three layers:
 *
 *     1. `spawnAgent` in `@swt-labs/orchestration` never includes this
 *        extension in its `extensions[]` list (plan 01-01).
 *     2. `spawnOrchestratorSession` in `@swt-labs/orchestration` is the
 *        ONLY caller that wires this extension (plan 03-02 T2).
 *     3. The mechanical regression test in
 *        `packages/runtime/test/ask-user/ask-user.test.ts` (A.6) iterates
 *        `AGENT_ROLES` and asserts every non-orchestrator role excludes
 *        the tool AND orchestrator includes it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * IPC contract (input → output):
 *
 *   Input  (JSON Schema validated by Pi at the boundary):
 *     {
 *       id:           string;                  // caller-supplied prompt UUID
 *       question:     string;                  // prompt text
 *       options:      Array<{                  // 1-4 options recommended
 *         id:           string;
 *         label:        string;
 *         isRecommended?: boolean;
 *       }>;
 *       header?:      string;
 *       multiSelect?: boolean;
 *       preview?:     string;
 *     }
 *
 *   Output:
 *     {
 *       selectedOption: string;                // option.id or 'other' for freeform
 *       freeform?:      string;                // present iff selectedOption === 'other'
 *     }
 *
 * The Pi `askUser` primitive answers with `{ selectedOption: label, freeform }`
 * keyed on the option *label* (its current public contract); this bridge maps
 * the label back to the option's `id` so the IPC schema is stable for the LLM.
 */

import type { PiExtensionAPI, PiToolExecuteResult } from '../extensions/pi-types.js';

import { askUser, type AskUserOption, type AskUserOptions } from './ask-user.js';

/**
 * Input parameter shape the Pi side validates against the JSON Schema below.
 * Mirrored as a TypeScript type for the `execute` callback.
 */
export interface SwtAskUserToolParams {
  readonly id: string;
  readonly question: string;
  readonly options: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly isRecommended?: boolean;
  }>;
  readonly header?: string;
  readonly multiSelect?: boolean;
  readonly preview?: string;
}

/**
 * Output the tool returns to the LLM via the Pi `details` field. The LLM
 * reads this through the structured-result convention; the `content` field
 * carries a human-readable summary.
 */
export interface SwtAskUserToolResult {
  readonly selectedOption: string;
  readonly freeform?: string;
}

/**
 * JSON Schema handed to Pi's `registerTool`. Hand-rolled (rather than Zod
 * derived) so the on-disk definition stays canonical regardless of Zod
 * patch versions — matches the pattern in
 * `extensions/result-protocol.ts` (`PARAMETERS_JSON_SCHEMA`).
 */
const PARAMETERS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['id', 'question', 'options'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    question: { type: 'string', minLength: 1 },
    options: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        required: ['id', 'label'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          label: { type: 'string', minLength: 1 },
          isRecommended: { type: 'boolean' },
        },
      },
    },
    header: { type: 'string' },
    multiSelect: { type: 'boolean' },
    preview: { type: 'string' },
  },
};

export interface BuildSwtAskUserExtensionOptions {
  /**
   * Test seam — override the `askUser` implementation. Default: the real
   * `askUser` from `./ask-user.js`. Tests inject a deterministic fake.
   */
  readonly askUserImpl?: typeof askUser;
  /**
   * Test seam — askUser options threaded into every call (e.g.,
   * `sessionId`, `fetch`, `isTTY`). Production callers pass `{ sessionId }`
   * so the dashboard's SSE filter routes the prompt to the right session.
   */
  readonly askUserOptions?: AskUserOptions;
}

/**
 * Tool name as registered on the Pi session. Exported as a typed constant so
 * the mechanical regression test in `ask-user.test.ts` (A.6) can import the
 * exact string without duplicating the literal.
 */
export const SWT_ASK_USER_TOOL_NAME = 'swt_ask_user';

/**
 * Build the `swt_ask_user` Pi-extension factory. Pi loads the extension at
 * session start; the factory captures `pi` in closure scope to call
 * `pi.registerTool(...)`. The tool's `execute` handler delegates to
 * `askUser()`.
 */
export function buildSwtAskUserExtension(
  opts: BuildSwtAskUserExtensionOptions = {},
): (pi: PiExtensionAPI) => void {
  const askUserImpl = opts.askUserImpl ?? askUser;
  const askUserOptions = opts.askUserOptions ?? {};
  return function swtAskUserExtension(pi: PiExtensionAPI): void {
    pi.registerTool<SwtAskUserToolParams>({
      name: SWT_ASK_USER_TOOL_NAME,
      label: 'Ask the human a structured question',
      description:
        'Ask the human a structured question (orchestrator-only). Renders in the dashboard when running; falls back to readline TTY prompt or non-TTY auto-accept otherwise. Use to gate confirmation, intent disambiguation, and UAT checkpoints.',
      promptSnippet: 'swt_ask_user — gate a decision on a structured human reply',
      promptGuidelines: [
        'Provide 1-4 structured options whenever possible; mark the recommended option with isRecommended: true.',
        'Use the id field to identify the choice unambiguously; the label is the human-readable text.',
        'The reply may carry a freeform string under selectedOption: "other" — handle it as free text.',
      ],
      parameters: PARAMETERS_JSON_SCHEMA,
      async execute(
        _toolCallId,
        rawParams,
        _signal,
        _onUpdate,
        _ctx,
      ): Promise<PiToolExecuteResult> {
        // Pi's `registerTool` typing is generic over TParams; we accept the
        // pre-validated payload directly. The JSON Schema above is the
        // trust boundary — no Zod re-parse needed for the structured-input
        // bridge (cf. result-protocol.ts where the LLM-supplied params
        // demand a defence-in-depth re-parse against the harvested
        // envelope shape).
        const params = rawParams;
        const mappedOptions: AskUserOption[] = params.options.map((opt) => ({
          label: opt.label,
          ...(opt.isRecommended !== undefined ? { isRecommended: opt.isRecommended } : {}),
        }));

        const response = await askUserImpl(
          {
            question: params.question,
            options: mappedOptions,
            ...(params.header !== undefined ? { header: params.header } : {}),
            ...(params.multiSelect !== undefined ? { multiSelect: params.multiSelect } : {}),
            ...(params.preview !== undefined ? { preview: params.preview } : {}),
          },
          askUserOptions,
        );

        // Map askUser's label-keyed reply back to the IPC contract's
        // `{selectedOption: option.id | 'other', freeform?}` shape. When
        // askUser returns freeform (selectedOption === null +
        // freeform !== null), the bridge surfaces 'other' as the
        // selectedOption and includes the freeform string.
        let result: SwtAskUserToolResult;
        if (response.selectedOption !== null) {
          const matched = params.options.find((opt) => opt.label === response.selectedOption);
          // If the matched option is missing (only possible if askUser's TTY
          // readline path accepted a label the orchestrator did not send),
          // fall back to the label string itself as the id — the LLM can
          // still interpret it but the structured-id round-trip degrades.
          result = {
            selectedOption: matched?.id ?? response.selectedOption,
          };
        } else {
          result = {
            selectedOption: 'other',
            ...(response.freeform !== null ? { freeform: response.freeform } : {}),
          };
        }

        return {
          content: [
            {
              type: 'text',
              text:
                result.selectedOption === 'other'
                  ? `swt_ask_user: user replied freeform "${result.freeform ?? ''}".`
                  : `swt_ask_user: user selected "${result.selectedOption}".`,
            },
          ],
          details: result,
        };
      },
    });
  };
}

/**
 * Default factory — equivalent to `buildSwtAskUserExtension()` with no
 * overrides. Pi loads extensions by default-export-of-factory convention;
 * this export is symmetric with `result-protocol.ts`'s default export so
 * callers wire it the same way.
 */
export default buildSwtAskUserExtension();
