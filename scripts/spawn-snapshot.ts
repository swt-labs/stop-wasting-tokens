/**
 * `scripts/spawn-snapshot.ts` — Phase 01 plan 01-01 T1.
 *
 * Deterministic CLI that captures the SWT-layer spawn configuration for every
 * (role × provider) pair so a Phase 1 no-op refactor can be proven
 * byte-identical via `diff -u`.
 *
 * What this captures (per I1 / Scout's surprise #4):
 *   - For each of the 7 SDLC roles (scout, architect, lead, dev, qa, debugger,
 *     docs) × 2 providers (anthropic, openai): the resolved
 *     `SpawnAgentSessionConfig` produced by `resolveSpawnAgentConfig`.
 *   - For the `'orchestrator'` role × 2 providers: the resolved
 *     `SpawnOrchestratorSessionConfig` produced by
 *     `resolveOrchestratorSessionConfig`.
 *
 * Per-entry shape (sorted keys at every level, no timestamps, no random ids,
 * no resolved-credential secrets, no caller-cwd-derived absolute paths):
 *
 *   {
 *     "role":                       "<role>",
 *     "provider":                   "<anthropic|openai>",
 *     "systemPrompt_sha256":        "<sha256 of finalSystemPrompt>",
 *     "systemPrompt_length":        <int>,
 *     "systemPrompt_head_256_chars":"<first 256 chars verbatim>",
 *     "systemPrompt_tail_256_chars":"<last 256 chars verbatim>",
 *     "extensions_names":           ["resultProtocol", "journal", ...],
 *     "tools_names_sorted":         ["create_file", "edit_file", ...],
 *     "thinkingLevel":              "<value or null>",
 *     "maxTurns":                   <int>,
 *     "sandboxMode":                "<value>",
 *     "contextFiles_count":         <int — number of fragments returned by pack.contextFiles>,
 *     "contextFiles_contentSha256": "<sha256 of fragments.join('\\n\\n')>",   // OMITTED when count == 0
 *     "contextFiles_paths":         []
 *   }
 *
 * Phase 17 plan 03-01 T3 — `contextFiles_count` is populated
 * deterministically from the resolved `SpawnAgentSessionConfig.contextFiles`
 * (was hardcoded `0` in Phase 1). `contextFiles_contentSha256` is the
 * sha256 of the joined-with-`'\n\n'` content; it is ONLY emitted when
 * count > 0. For empty / absent contextFiles, the field is omitted
 * entirely so the serialized JSON stays byte-identical to Phase 2's
 * after-state baseline for every (provider, role) pair whose count
 * was already 0 — the strict D2 reading. The `contextFiles_paths`
 * field is retained as a stable empty array — pack returns content
 * strings, not paths. Determinism choice + D2 strategy documented in
 * `.vbw-planning/phases/03-agents-md-hierarchical-loader/spawn-snapshot.diff.md`.
 *
 * Determinism guarantees:
 *   - Fixed `installRoot` resolved from the script's own location (not
 *     `process.cwd()`).
 *   - Fixed `cwd = '/tmp/swt-spawn-snapshot'`.
 *   - Fixed `sessionId = '00000000-0000-0000-0000-000000000000'`.
 *   - Fixed `model = ''` to avoid env-derived defaults.
 *   - No `Date.now()`, no `crypto.randomUUID()`, no `process.env.*` reads.
 *   - JSON output uses sorted keys at every level.
 *   - Entries are sorted by `(provider, role)`.
 *   - `resolvedCredential` is never serialized (would leak; also varies per env).
 *
 * Verification:
 *   $ pnpm tsx scripts/spawn-snapshot.ts > /tmp/a.json
 *   $ pnpm tsx scripts/spawn-snapshot.ts > /tmp/b.json
 *   $ diff -u /tmp/a.json /tmp/b.json   # must return empty
 */

import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSpawnAgentConfig, resolveOrchestratorSessionConfig } from '@swt-labs/orchestration';
import type { AgentRole } from '@swt-labs/shared';

// ----------------------------------------------------------------------------
// Deterministic constants (no env reads, no clock, no random ids).
// ----------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// Script lives at <repoRoot>/scripts/spawn-snapshot.ts → installRoot = repoRoot.
const INSTALL_ROOT = resolve(SCRIPT_DIR, '..');
const FIXED_CWD = '/tmp/swt-spawn-snapshot';
const FIXED_SESSION_ID = '00000000-0000-0000-0000-000000000000';
const FIXED_MODEL = '';

// 7 SDLC roles (orchestrator is handled separately via the orchestrator
// resolver). Order is alphabetized so the per-(provider, role) sort is stable.
const SDLC_ROLES: readonly AgentRole[] = [
  'architect',
  'debugger',
  'dev',
  'docs',
  'lead',
  'qa',
  'scout',
];

const PROVIDERS: readonly string[] = ['anthropic', 'openai'];

// ----------------------------------------------------------------------------
// Helpers — deterministic JSON serialization with sorted keys at every depth.
// ----------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Recursively rebuild the value so JSON.stringify emits keys in sorted order
 * at every depth. Arrays preserve their declared order (call sites that need
 * sorted arrays must sort before handing them in).
 */
function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => withSortedKeys(v));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      out[k] = withSortedKeys(obj[k]);
    }
    return out;
  }
  return value;
}

function deterministicJson(value: unknown): string {
  return JSON.stringify(withSortedKeys(value), null, 2);
}

interface SnapshotEntry {
  readonly role: string;
  readonly provider: string;
  readonly systemPrompt_sha256: string;
  readonly systemPrompt_length: number;
  readonly systemPrompt_head_256_chars: string;
  readonly systemPrompt_tail_256_chars: string;
  readonly extensions_names: readonly string[];
  readonly tools_names_sorted: readonly string[];
  readonly thinkingLevel: string | null;
  readonly maxTurns: number;
  readonly sandboxMode: string;
  readonly contextFiles_count: number;
  /**
   * Phase 17 plan 03-01 T3 — only emitted when `contextFiles_count > 0`.
   * For empty / absent contextFiles, the field is omitted from the
   * serialized JSON entirely (NOT serialized as `""`), preserving
   * byte-identity vs Phase 2's pre-Phase-3 baseline for every entry
   * whose count was already 0. This is the strict reading of D2: the
   * Anthropic snapshot stays byte-identical, and OpenAI entries
   * whose cwd has no AGENTS.md content also stay byte-identical.
   */
  readonly contextFiles_contentSha256?: string;
  readonly contextFiles_paths: readonly string[];
}

function buildEntry(args: {
  role: string;
  provider: string;
  systemPrompt: string;
  extensionsNames: readonly string[];
  toolsNames: readonly string[];
  thinkingLevel: string | null | undefined;
  maxTurns: number;
  sandboxMode: string;
  contextFiles: readonly string[] | undefined;
}): SnapshotEntry {
  const head = args.systemPrompt.slice(0, 256);
  const tail = args.systemPrompt.length <= 256 ? '' : args.systemPrompt.slice(-256);
  // Phase 17 plan 03-01 T3 — determinism option A: count + sha256 of the
  // joined-with-`'\n\n'` content, but ONLY when the count > 0. Empty
  // arrays omit the sha256 field entirely, preserving byte-identity vs
  // the Phase 2 baseline for empty entries (the strict D2 reading).
  const fragments = args.contextFiles ?? [];
  const joined = fragments.join('\n\n');
  const base = {
    role: args.role,
    provider: args.provider,
    systemPrompt_sha256: sha256Hex(args.systemPrompt),
    systemPrompt_length: args.systemPrompt.length,
    systemPrompt_head_256_chars: head,
    systemPrompt_tail_256_chars: tail,
    // extensions_names preserve declared order — order is part of the no-op proof.
    extensions_names: [...args.extensionsNames],
    // tools_names_sorted is sorted ascending — tool order isn't part of the
    // semantic contract; sorting cancels harmless reordering and isolates
    // membership drift.
    tools_names_sorted: [...args.toolsNames].sort(),
    thinkingLevel: args.thinkingLevel ?? null,
    maxTurns: args.maxTurns,
    sandboxMode: args.sandboxMode,
    // Phase 17 plan 03-01 T3 — count is always emitted (was already
    // present in Phase 2's baseline as the hardcoded `0`); the sha256
    // field is conditional below.
    contextFiles_count: fragments.length,
    // Retained as a stable empty array — pack returns content, not paths.
    // Kept on the schema to minimize churn for the diff against Phase 2's
    // snapshot baseline.
    contextFiles_paths: [],
  };
  // Conditional spread keeps the sha256 field OUT of the serialized JSON
  // when fragments are empty — Anthropic and orchestrator entries stay
  // byte-identical to Phase 2's after-state. OpenAI entries whose cwd
  // has no AGENTS.md content (including `FIXED_CWD`) also stay
  // byte-identical at the JSON-text level.
  return fragments.length === 0 ? base : { ...base, contextFiles_contentSha256: sha256Hex(joined) };
}

function captureSdlcRoleEntry(role: AgentRole, provider: string): SnapshotEntry {
  const config = resolveSpawnAgentConfig({
    role,
    prompt: '',
    model: FIXED_MODEL,
    provider,
    cwd: FIXED_CWD,
    sessionId: FIXED_SESSION_ID,
    installRoot: INSTALL_ROOT,
  });
  return buildEntry({
    role,
    provider,
    systemPrompt: config.systemPrompt,
    extensionsNames: config.extensions.map((e) => e.name),
    toolsNames: config.tools.map((t) => t.name),
    thinkingLevel: config.thinkingLevel ?? null,
    maxTurns: config.maxTurns,
    sandboxMode: config.sandboxMode,
    // Phase 17 plan 03-01 T3 — read pack-resolved AGENTS.md fragments
    // from the resolved config (Task 2 wired the field). For
    // `FIXED_CWD = '/tmp/swt-spawn-snapshot'` the loader returns `[]`
    // (no `.git` ancestor, no AGENTS.md), so the OpenAI snapshot count
    // stays 0 and the sha256 stays the empty-string sentinel. Walk-up
    // correctness is proven via `packages/orchestration/test/agents-md-loader.test.ts`.
    contextFiles: config.contextFiles,
  });
}

function captureOrchestratorEntry(provider: string): SnapshotEntry {
  const config = resolveOrchestratorSessionConfig({
    prompt: '',
    cwd: FIXED_CWD,
    sessionId: FIXED_SESSION_ID,
    installRoot: INSTALL_ROOT,
    provider,
    model: FIXED_MODEL,
  });
  return buildEntry({
    role: 'orchestrator',
    provider,
    systemPrompt: config.systemPrompt,
    extensionsNames: config.extensions.map((e) => e.name),
    toolsNames: config.tools.map((t) => t.name),
    thinkingLevel: config.thinkingLevel ?? null,
    maxTurns: config.maxTurns,
    sandboxMode: config.sandboxMode,
    // Orchestrator path never invokes `pack.contextFiles()` (Phase 1 §5
    // surprise — orchestrator pack-selection is decoupled from agent
    // pack-selection). `SpawnOrchestratorSessionConfig` has no
    // `contextFiles` field; pass `undefined` so the entry shows
    // count=0 + empty sha256.
    contextFiles: undefined,
  });
}

function main(): void {
  const entries: SnapshotEntry[] = [];
  // Iterate (provider, role) deterministically. Output ordering is keyed on
  // (provider, role) per the snapshot-fixture protocol.
  for (const provider of PROVIDERS) {
    for (const role of SDLC_ROLES) {
      entries.push(captureSdlcRoleEntry(role, provider));
    }
    entries.push(captureOrchestratorEntry(provider));
  }
  // Stable sort by (provider, role) — provider already cycles outer; this
  // also normalizes any accidental insertion-order drift if SDLC_ROLES is
  // ever reshuffled.
  entries.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1;
    if (a.role !== b.role) return a.role < b.role ? -1 : 1;
    return 0;
  });
  const out = {
    schema_version: 1,
    entry_count: entries.length,
    entries,
  };
  process.stdout.write(deterministicJson(out) + '\n');
}

main();
