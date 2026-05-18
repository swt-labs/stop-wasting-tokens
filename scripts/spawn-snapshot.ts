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
 *     "contextFiles_count":         0,
 *     "contextFiles_paths":         []
 *   }
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
}): SnapshotEntry {
  const head = args.systemPrompt.slice(0, 256);
  const tail = args.systemPrompt.length <= 256 ? '' : args.systemPrompt.slice(-256);
  return {
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
    // Phase 1 — `contextFiles` is always [] (D4 — Phase 3 lights up AGENTS.md).
    contextFiles_count: 0,
    contextFiles_paths: [],
  };
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
