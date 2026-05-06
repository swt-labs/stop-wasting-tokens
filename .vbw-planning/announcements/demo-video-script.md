# Demo video script — v1.0 launch

**Target length:** 6 minutes (5–8 acceptable)
**Pacing:** Deliberate. No fast-cuts. Show the runtime, don't sell it.
**Tone:** Matter-of-fact. The methodology speaks for itself.

---

## 0:00 — Cold open (15s)

[B-roll: terminal showing a long Codex chat with the same project context being re-explained]

> "Last week you re-explained your project to Codex four times across six sessions. Three of those sessions ended with abandoned features. The cost shows up as wasted hours, not just wasted tokens."

---

## 0:15 — Problem framing (45s)

[B-roll: split screen — chat history on the left, an empty `.swt-planning/` tree on the right]

> "stop-wasting-tokens structures the work so token spend goes toward _new_ progress.
>
> Phases on disk. Plans on disk. Verification as a separate stage.
>
> Codex reads the contract. You read the diff. Nothing evaporates between sessions."

[Pull up to show the eleven lifecycle states diagram from the docs site]

> "Eleven deterministic lifecycle states. `swt detect-phase` returns the same routing decision for the same disk state, every time."

---

## 1:00 — Install + init (60s)

[Live terminal — clean shell, large font]

```
$ npm install -g @swt-labs/cli
$ swt --version
1.0.0
$ mkdir demo-todo && cd demo-todo
$ swt init
```

[Capture the two prompts: planning_tracking, auto_push]

> "One install. One init. Two prompts. Defaults are safe — manual + never.
>
> Existing repo? It detects brownfield and runs codebase mapping in the background."

---

## 2:00 — Plan + execute Phase 1 (120s)

[Live terminal]

```
$ swt vibe
```

[Walk through the bootstrap dialog → discussion engine asks about must-have features and audience → scope into 3 phases]

> "Phase one: storage layer. Phase two: CLI commands. Phase three: tests + packaging.
>
> The runtime decomposes my one-liner into a roadmap. I review. I edit if I want. I move on."

```
$ swt vibe
```

[Plan + Execute kicks in. Lead spawns. Writes 01-01-PLAN.md.]

> "Lead writes the plan. Typed must-haves. Tasks ordered by dependency.
>
> Dev agents execute the plan. QA verifies row-by-row against each must-have.
>
> The runtime knows where I am at every step. If I close my terminal and come back tomorrow — `swt detect-phase` returns the same answer."

[Show the SUMMARY.md output: tasks complete, ac_results all PASS, files modified, commits made]

---

## 4:00 — Verification + UAT (90s)

[Live terminal — auto-routes to UAT after Plan + Execute completes]

> "auto_uat is on by default. Verify chains directly into UAT.
>
> Each test scenario presents one at a time. I walk through and confirm or fail."

[Walk three checkpoints — pass two, fail one. Show the friction]

> "Test fails. The runtime writes the failure into 01-UAT.md and routes to remediation.
>
> Research. Plan. Execute. Re-verify.
>
> If a test fails three rounds in a row, the runtime annotates it as recurring — Scout investigates _why_ prior fixes didn't stick before proposing a new approach."

[Show round-01 dir structure: R01-RESEARCH.md, R01-PLAN.md, R01-SUMMARY.md, R01-VERIFICATION.md]

---

## 5:30 — Archive + reset (30s)

[Live terminal]

```
$ swt vibe
```

[All phases pass → routes to Archive → 7-point audit runs → milestone tagged]

> "All phases pass. The 7-point audit runs: roadmap completeness, plan coverage, summary status, fresh QA, UAT clean, requirements coverage, hard UAT gate.
>
> Milestone archives to `.swt-planning/milestones/01-todo-cli/`. Git tag created. State resets to project-level. The next milestone starts clean."

---

## 6:00 — CTA (30s)

[Static slate: install command + docs URL + GitHub icon]

```
npm install -g @swt-labs/cli
docs.stopwastingtokens.dev
```

> "npm install -g @swt-labs/cli. docs.stopwastingtokens.dev.
>
> Closed beta is open this week.
>
> Try it. Tell me what's broken."

---

## End slate (5s)

URL + GitHub icon + Discord icon. Hold for 5 seconds before fade.

---

## Production notes

- Record at 1080p minimum, 60fps preferred for terminal cuts
- Use a clean monospace font (JetBrains Mono / Fira Code), light theme on dark background
- Mic check before record — no AC hum, no keyboard clack
- Two takes minimum per section; pick the take that lands the timing
- Subtitles required (auto-gen via YouTube + manual review for technical terms)
- Background music: instrumental, low BPM, no lyrics. Outro can lift slightly for the CTA.
- Total length: aim for 6:00 ± 0:30. If you go over 8:00, cut the recurrence-issue example from 4:00.

## Distribution

- Primary: YouTube (canonical), embed in `docs/blog/v1-0-launch.mdx`
- Secondary: Twitter/X (90-second cut from 0:00–1:30)
- Tertiary: Discord (full version)
