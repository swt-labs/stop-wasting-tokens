# v1.5 abstractions audit

Date: 2026-05-06
Scope: `packages/core/src/abstractions/{HookHost, AgentSpawner, PermissionGate, MemoryStore, Prompter}.ts`
Goal: identify any Codex-specific leakage that would block a Claude Code or Ollama driver from implementing the same interface.

## Summary

| Abstraction | Findings | Status |
|------------|----------|--------|
| HookHost | 1 clean, 1 minor | Clean — driver-portable |
| AgentSpawner | 2 clean, 1 minor | Clean — driver-portable |
| PermissionGate | 1 clean, 1 minor | Clean — driver-portable |
| MemoryStore | 2 clean, 1 cosmetic | Clean — driver-portable |
| Prompter | 1 clean | Clean |

**Overall readiness:** PASS. The four core abstractions are driver-agnostic. Three minor improvements + one cosmetic recommendation captured below as v1.5 candidates — none block Claude Code or Ollama driver implementation.

## HookHost

### Findings

| Location | Category | Severity | Note |
|----------|----------|----------|------|
| HookHost.ts:5-12 | clean | — | `HookEvent` is a union of 6 generic lifecycle events (session_start, user_prompt_submit, pre_tool_use, post_tool_use, permission_request, stop). No Codex-specific event names. Comment explicitly notes "Backends may support additional events natively." |
| HookHost.ts:18 | minor | minor | `HookContext.payload: Record<string, unknown>` is documented as "Backend-specific event payload." Claude Code's 12-event taxonomy will need to surface event-typed narrowing helpers in `@swt-labs/claude-code-driver` (e.g., `isPreToolUseEvent(ctx)` predicate). v1.5 candidate, not a blocker. |

### Recommendation

HookHost is driver-portable. The 6 generic events cover the methodology layer's needs. Claude Code's expanded taxonomy lives in driver-side narrowing helpers, not in the core abstraction.

## AgentSpawner

### Findings

| Location | Category | Severity | Note |
|----------|----------|----------|------|
| AgentSpawner.ts:4-12 | clean | — | `AgentSpec` is generic — role, model, reasoning_effort, developer_instructions, allowed_mcp_servers, optional sandbox_mode + max_turns. No Codex-specific fields. |
| AgentSpawner.ts:43-46 | minor | minor | JSDoc comment says "On Codex this writes a TOML agent file and invokes `codex exec`; on other backends it does the equivalent." This is descriptive prose, not a contract leak — but the v1.5 driver implementations should add their own per-driver doc references when they land. |
| AgentSpawner.ts:14-21 | clean | — | `SpawnRequest` shape is generic — spec + prompt + cwd + session_id + optional structured input. Reusable across drivers. |

### Recommendation

AgentSpawner is the load-bearing abstraction for v1.5 drivers. The interface is clean. Claude Code driver implements `installAgent` as a no-op (Claude Code uses session-scoped subagents, no persistent install). Ollama driver implements both via a thin process-spawn wrapper. No core changes needed.

## PermissionGate

### Findings

| Location | Category | Severity | Note |
|----------|----------|----------|------|
| PermissionGate.ts:1-3 | clean | — | `SandboxMode` union (`read-only` / `workspace-write` / `danger-full-access`) and `ApprovalPolicy` union (`untrusted` / `on-request` / `never`) are Codex-naming-conventions but the semantics are universal. v1.5 drivers can map their native concepts onto these names. |
| PermissionGate.ts:13-15 | minor | minor | `PermissionRequest.tool: string` is untyped — works fine for Codex's free-form tool names but Claude Code's tool taxonomy is narrower. Claude Code driver adds a typed enum on top in `@swt-labs/claude-code-driver/src/tool-types.ts`. Not a core change. |

### Recommendation

PermissionGate is portable. The `SandboxMode` / `ApprovalPolicy` names happen to match Codex's vocabulary but the semantics are generic. Driver-specific tool taxonomy stays driver-side.

## MemoryStore

### Findings

| Location | Category | Severity | Note |
|----------|----------|----------|------|
| MemoryStore.ts:1-7 | clean | — | `MemoryEntry` shape (id, topic, content, optional created_at, optional tags) is generic key-value-store shaped. No backend coupling. |
| MemoryStore.ts:21-25 | clean | — | JSDoc references "MEMORY.md self-healing memory model" — methodology concept, not backend concept. |
| MemoryStore.ts:24 | cosmetic | cosmetic | JSDoc bullet mentions "backend session continuity (e.g., `codex resume` rollouts)" as a parenthetical. The example is Codex-specific but the underlying concept (session continuity) is universal. Recommend rephrasing as "backend session continuity (e.g., `codex resume` on Codex, conversation forking on Claude Code, model checkpoint on Ollama)" when v1.5 drivers land. Cosmetic — not a contract change. |

### Recommendation

MemoryStore is portable. Topic-keyed key-value with optional tags is universal. The cosmetic JSDoc rephrase lands alongside Claude Code driver implementation in v1.5.

## Prompter

### Findings

| Location | Category | Severity | Note |
|------------------|----------|----------|------|
| Prompter.ts (full file) | clean | — | Three method signatures (`askChoice`, `askText`, `askConfirm`) — pure abstraction with no backend coupling. ScriptedPrompter (test/mock-driver.ts) and ReadlinePrompter (terminal interactive) both already implement it cleanly. v1.5 drivers don't need to touch this. |

### Recommendation

Prompter is fully portable. No changes needed for v1.5 drivers.

## Outstanding follow-ups (all v1.5 candidates, none gating)

1. **HookHost narrowing helpers** for Claude Code's 12-event taxonomy — add `isPreToolUseEvent(ctx)` style predicates in `@swt-labs/claude-code-driver`.
2. **Claude Code driver tool-types enum** — narrow `PermissionRequest.tool: string` driver-side.
3. **MemoryStore JSDoc rephrase** — replace the `codex resume` parenthetical with multi-driver examples when v1.5 ships.

These are all driver-side work, not core abstraction changes. The v1.0 `@swt-labs/core` abstraction layer is forward-compatible with v1.5 driver implementations as-is.
