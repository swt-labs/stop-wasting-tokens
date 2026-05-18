# AGENTS.md

End-user reference for authoring `AGENTS.md` content consumed by SWT-on-OpenAI sessions.

## Purpose

`AGENTS.md` is the canonical [Codex CLI](https://github.com/openai/codex) mechanism for injecting project context — build commands, naming conventions, test entry points, code-review preferences — into model sessions. SWT honors Codex's hierarchical loading semantics so a single `AGENTS.md` authored for Codex CLI works unchanged in SWT-on-OpenAI sessions. You don't need to maintain a separate "SWT AGENTS.md" — the file you already author for Codex is the file SWT reads.

Authoring guidance: keep the content terse, reference-style, and project-specific. Build commands, test entry points, and codebase conventions are higher-leverage than narrative prose. The content is prepended to the first model turn alongside the role's system prompt, so every token counts.

## Hierarchical loading

When a session is spawned with `provider=openai`, SWT walks the filesystem from the session's working directory upward to the project root (the nearest `.git`-ancestor), collecting `AGENTS.md` at each directory level. Files are concatenated **root-first → cwd-last**, joined with a `\n\n` separator.

Example — cwd `/repo/packages/dashboard`, project root `/repo`:

- `/repo/AGENTS.md` (if present)
- `/repo/packages/AGENTS.md` (if present)
- `/repo/packages/dashboard/AGENTS.md` (if present)

Levels with no `AGENTS.md` contribute nothing. Empty (or whitespace-only) files also contribute nothing. The order is **fixed** — root content always lands before child content, so root-level conventions establish the baseline and deeper levels refine.

If the cwd has no `.git`-ancestor anywhere in the chain, the loader falls back to cwd-only resolution (it reads `AGENTS.md` in the cwd itself, if present, and nothing higher).

## `AGENTS.override.md` semantics

`AGENTS.override.md` **replaces** `AGENTS.md` at the same directory level. The loader checks for `AGENTS.override.md` first; if it exists, it is used and `AGENTS.md` at that same level is never consulted. This is `break`-after-first-match REPLACE semantics, not layered concatenation.

Example — at `/repo/packages` both `AGENTS.md` and `AGENTS.override.md` exist; cwd is `/repo/packages/dashboard`:

- `/repo/AGENTS.md` is concatenated normally (root level, no override there).
- `/repo/packages/AGENTS.override.md` is concatenated (REPLACE — `/repo/packages/AGENTS.md` is skipped).
- `/repo/packages/dashboard/AGENTS.md` is concatenated normally (cwd level, no override there).

The override mechanism is useful when you want a specific subdirectory's context to differ wholesale from what an `AGENTS.md` at that level would say — for example, an experimental package where the parent's conventions don't apply. Most projects don't need overrides.

## OpenAI-only caveat

SWT injects `AGENTS.md` content **only for OpenAI sessions**. Anthropic sessions receive no `AGENTS.md` content by design.

This is a deliberate provider-isolation boundary (Codex's `AGENTS.md` spec has no Anthropic-side parity item; an Anthropic-equivalent project-context mechanism does not exist upstream). If you need Anthropic sessions to see project context, place it in the role's base prompt at `agents/swt-<role>.md` or in a provider overlay at `provider_overlays/<role>-anthropic.md` (none exist today by design — see `provider_overlays/README.md`).

## Orchestrator role exception

The orchestrator role does **not** receive `AGENTS.md` content, even on OpenAI. The orchestrator's spawn path (`packages/orchestration/src/spawn-orchestrator-session.ts`) is decoupled from the agent spawn path and does not invoke `pack.contextFiles()`. Orchestrator system prompts come from the body of `commands/cook.md`, not from project-level `AGENTS.md`.

If you want project-level context inside the orchestrator's session, put it in `agents/swt-orchestrator.md` (or a `provider_overlays/orchestrator-<provider>.md` overlay) rather than `AGENTS.md`.

## Behavioral vs structural parity (Pi 0.74 caveat)

Codex CLI injects `AGENTS.md` at the system prompt level — the OpenAI Responses API `instructions` field (role: `system`). Pi 0.74 has no native `systemPrompt` input on `createAgentSession`, so SWT prepends `AGENTS.md` content to the first `session.prompt()` call instead.

The content is model-visible from turn 1 in both cases (**behavioral equivalence**); however, in SWT-on-Pi the content technically rides on the first user-turn prompt payload rather than the system slot (**structural difference**). If a future Pi version exposes a `systemPrompt` input, the injection site can migrate without changing authoring or content semantics.
