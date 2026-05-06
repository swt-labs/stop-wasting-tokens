🚀 v0.1.0-alpha of stop-wasting-tokens is live.

A token-disciplined methodology runtime for Codex CLI:
• 11 deterministic lifecycle states
• phases → plans → summaries (typed Zod contracts)
• QA + UAT separation with bounded remediation rounds
• VBW-compatible (mv .vbw-planning .swt-planning)

`npm i -g @swt-labs/cli`

Closed beta this week. DM for invite.

🧵 1/4

---

(2/4) The problem: Codex burns tokens on rework. Re-explaining context every session, re-implementing abstractions, hand-waving verification.

The cost shows up as wasted hours, not just wasted tokens.

---

(3/4) The fix: structure the work.

Every project decomposes into phases → plans → summaries. Each artifact is on disk. The runtime knows where you left off (deterministic state machine, 11 lifecycle states).

Verification is a separate stage. UAT remediation has round caps + recurrence tracking.

---

(4/4) Built on the VBW methodology (Claude Code plugin) but as a portable npm CLI. v1.0 targets Codex; v1.5 adds Claude Code + Ollama drivers behind the same abstractions.

Docs: docs.stopwastingtokens.dev
Repo: github.com/swt-labs/stop-wasting-tokens

Try it. Tell me what's broken.
