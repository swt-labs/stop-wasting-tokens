**Show HN: stop-wasting-tokens — a token-disciplined SDLC for Codex CLI**

I've been running multi-week projects on Codex and burning tokens on rework: re-explaining context every session, re-implementing abstractions, hand-waving verification. The cost shows up as wasted hours, not just wasted tokens.

SWT structures the work so token spend goes toward _new_ progress, not toward re-explaining context.

11 deterministic lifecycle states. Phases → plans → summaries (typed Zod contracts). Verification is a separate stage with row-by-row evidence. UAT remediation has bounded round caps and recurrence tracking — if a test fails three rounds in a row, you get a recurrence annotation telling Scout to investigate why prior fixes failed before proposing a new approach.

Built on the VBW methodology (a Claude Code plugin) but distributed as a portable npm CLI. v1.0 targets the Codex CLI; v1.5 adds Claude Code and Ollama drivers behind the same four core abstractions.

What's different from "just use Codex more carefully":
- State persists to disk (`.swt-planning/`), not to chat history
- `swt detect-phase` is the contract — same disk state always returns the same routing decision
- QA + UAT separation, with a hard UAT gate at archive
- Cross-platform: pure Node/TypeScript, no Bash hard dependency

```
npm install -g @swt-labs/cli
swt init
swt vibe
```

Docs: https://docs.stopwastingtokens.dev
Repo: https://github.com/swt-labs/stop-wasting-tokens

Honest feedback welcome — what's the first thing that surprises or annoys you?
