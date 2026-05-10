#!/usr/bin/env python3
"""
SWT idiot check — comprehensive CLI mechanics smoke test.

Verifies a fresh `npm i -g stop-wasting-tokens` install actually behaves
as documented. Tests the *mechanics* of every command and HTTP surface,
not benchmark / quality / token-cost concerns.

Coverage by surface area:

  ─── Built-ins ──────────────────────────────────────────────────────
  B1  swt --version                  (matches semver, exit 0)
  B2  swt --help                     (lists registered commands)
  B3  swt help                       (matches --help output)
  B4  swt version                    (matches --version)
  B5  swt doctor                     (exit 0, runs environment checks)

  ─── Local state ───────────────────────────────────────────────────
  L1  swt detect-phase               (greenfield → JSON shape sane)
  L2  swt detect-phase --bash-format (greenfield → key=value pairs)
  L3  swt config show                (lists effort, autonomy, etc.)
  L4  swt config get / set           (round-trip)
  L5  swt config set creates dir     (mkdir -p .swt-planning if missing)
  L6  swt status                     (greenfield exit 1, no crash)
  L7  swt init <name>                (scaffolds .swt-planning/ + files)

  ─── CLI surface ───────────────────────────────────────────────────
  C1  unknown verb                   (exit USAGE_ERROR + helpful stderr)
  C2  SWT_NO_DASHBOARD=1 swt         (escape hatch prints help)
  C3  swt watch                      (Ink TUI starts and exits cleanly)
  C4  swt --invalid-flag             (rejects with USAGE_ERROR)
  C5  21 stub verbs                  (each returns NOT_IMPLEMENTED cleanly)

  ─── Network ───────────────────────────────────────────────────────
  N1  swt update --json              (returns valid JSON with status)

  ─── Dashboard HTTP ────────────────────────────────────────────────
  D1  GET /api/health                (status=ok, daemon_version present)
  D2  GET /api/snapshot              (greenfield → is_initialized=false)
  D3  GET /                          (serves SPA HTML)
  D4  POST /api/command literal      (routing_decision=literal, runs verb)
  D5  POST /api/command interactive  (rejected_interactive, no spawn)
  D6  POST /api/command unknown      (rejected_unknown)
  D7  GET /api/config                (greenfield → is_initialized=false + DEFAULT_CONFIG)
  D8  GET /api/doctor                (overall_status enum + checks[] shape)
  D9  GET /api/detect-phase          (greenfield → is_initialized=false)
  D10 GET /api/update                (current_version + registry='npm')
  D11 GET /api/commands              (verbs[] with dashboard_safe field)

  ─── Dashboard vibe (v2.0) ─────────────────────────────────────────
  V1  POST /api/vibe                 (default → agent_backend=none)
  V2  POST /api/vibe/:bad/reply      (404 session_not_found)
  V3  SWT_VIBE_AGENT=codex daemon    (factory wired → agent_backend=codex)

  ─── Dashboard SSE ─────────────────────────────────────────────────
  E1  GET /api/events                (Content-Type: text/event-stream)
  E2  GET /api/events?session_id=X   (filter accepts query param)

What this script does NOT do:
  - Track B (full vibe lifecycle on a real project) is interactive and
    needs Codex CLI + AskUserQuestion CHECKPOINT loop responses. Run
    those steps manually after Track A passes.
  - Browser-side dashboard UI checks (CSS, layout, hover, click). The
    HTTP contract is testable from this script; the rendered SPA is not.
  - Performance / token-cost / agent quality. This script is mechanics-
    only.

Exit codes:
  0  — all checks pass
  1  — one or more checks failed
  2  — script-level error (swt not on PATH, etc.)

No external dependencies — pure Python 3.8+ stdlib.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Iterator, Optional

# ──────────────────────────────────────────────────────────────────────
# output helpers
# ──────────────────────────────────────────────────────────────────────

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def _supports_color() -> bool:
    return sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


# ──────────────────────────────────────────────────────────────────────
# result tracking
# ──────────────────────────────────────────────────────────────────────


@dataclass
class CheckResult:
    section: str
    id: str
    label: str
    status: str  # 'pass' | 'fail' | 'skip'
    detail: str = ""


@dataclass
class TestRun:
    results: list[CheckResult] = field(default_factory=list)
    color: bool = True
    section_name: str = ""

    def _wrap(self, text: str, code: str) -> str:
        return f"{code}{text}{RESET}" if self.color else text

    def section(self, title: str) -> None:
        self.section_name = title
        bar = "─" * 60
        print()
        print(self._wrap(bar, BOLD))
        print(self._wrap(f"  {title}", BOLD))
        print(self._wrap(bar, BOLD))

    def _print(self, symbol: str, code: str, id: str, label: str, detail: str = "") -> None:
        sym = self._wrap(symbol, code)
        chip = self._wrap(id, CYAN)
        print(f"  {sym} {chip}  {label}")
        if detail:
            for line in detail.splitlines():
                print(f"        {self._wrap(line, DIM)}")

    def passed(self, id: str, label: str, detail: str = "") -> None:
        self.results.append(CheckResult(self.section_name, id, label, "pass", detail))
        self._print("✓", GREEN, id, label, detail)

    def failed(self, id: str, label: str, detail: str) -> None:
        self.results.append(CheckResult(self.section_name, id, label, "fail", detail))
        self._print("✗", RED, id, label, detail)

    def skipped(self, id: str, label: str, detail: str) -> None:
        self.results.append(CheckResult(self.section_name, id, label, "skip", detail))
        self._print("○", YELLOW, id, label, detail)

    def summary(self) -> int:
        passed = sum(1 for r in self.results if r.status == "pass")
        failed = sum(1 for r in self.results if r.status == "fail")
        skipped = sum(1 for r in self.results if r.status == "skip")
        total = len(self.results)

        print()
        print(self._wrap("━" * 60, BOLD))
        print(self._wrap("  SUMMARY", BOLD))
        print(self._wrap("━" * 60, BOLD))
        print(f"  total:    {total}")
        print(f"  {self._wrap('passed:', GREEN)}   {passed}")
        if failed:
            print(f"  {self._wrap('failed:', RED)}   {failed}")
        else:
            print(f"  failed:   {failed}")
        if skipped:
            print(f"  {self._wrap('skipped:', YELLOW)}  {skipped}")
        print()

        if failed == 0 and total > 0:
            print(f"  {self._wrap('✓ all green — install is sane', GREEN + BOLD)}")
            return 0
        if failed:
            print(f"  {self._wrap('✗ failures', RED + BOLD)}:")
            for r in self.results:
                if r.status == "fail":
                    head = r.detail.splitlines()[0] if r.detail else ""
                    print(f"    [{r.id}] {r.label}: {head}")
            return 1
        return 0


# ──────────────────────────────────────────────────────────────────────
# subprocess helpers
# ──────────────────────────────────────────────────────────────────────


def run_swt(
    args: list[str],
    cwd: Optional[str] = None,
    timeout: int = 30,
    env: Optional[dict] = None,
) -> tuple[int, str, str]:
    """Run `swt {args}` and return (exit_code, stdout, stderr)."""
    try:
        result = subprocess.run(
            ["swt", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -2, "", f"timeout after {timeout}s"
    except FileNotFoundError:
        return -1, "", "swt: command not found on PATH"


# ──────────────────────────────────────────────────────────────────────
# HTTP helpers (stdlib only)
# ──────────────────────────────────────────────────────────────────────


def http_get_json(url: str, timeout: float = 5.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_get_raw(url: str, timeout: float = 5.0) -> tuple[int, dict, bytes]:
    """GET; return (status_code, headers, body_bytes)."""
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.status, dict(resp.headers), resp.read()


def http_post_json(
    url: str, body: dict, timeout: float = 5.0
) -> tuple[int, dict]:
    """POST JSON; return (status_code, response_json). Raises on HTTP errors."""
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            return e.code, json.loads(body_text)
        except json.JSONDecodeError:
            return e.code, {"_raw": body_text}


def find_free_port(start: int = 54399, end: int = 54499) -> int:
    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"no free port in {start}..{end}")


@contextmanager
def dashboard_daemon(
    cwd: str,
    port: int,
    env_overrides: Optional[dict] = None,
    boot_timeout: float = 15.0,
) -> Iterator[subprocess.Popen]:
    """Boot `swt dashboard --no-open --port=...` in the background.

    Waits up to `boot_timeout`s for /api/health to return status=ok before
    yielding. SIGTERMs the child on exit (KILL after 5s).

    `env_overrides` merges into the child's env (e.g., SWT_VIBE_AGENT=codex).
    """
    env = dict(os.environ)
    if env_overrides:
        env.update(env_overrides)
    proc = subprocess.Popen(
        ["swt", "dashboard", "--no-open", f"--port={port}"],
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        env=env,
    )
    deadline = time.monotonic() + boot_timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            stderr_bytes = proc.stderr.read() if proc.stderr else b""
            stderr = stderr_bytes.decode("utf-8", errors="replace")
            raise RuntimeError(f"daemon exited early (code {proc.returncode}): {stderr}")
        try:
            data = http_get_json(f"http://127.0.0.1:{port}/api/health", timeout=1.0)
            if data.get("status") == "ok":
                break
        except (urllib.error.URLError, ConnectionError, json.JSONDecodeError):
            time.sleep(0.3)
    else:
        proc.terminate()
        raise RuntimeError(f"daemon failed to respond on port {port} within {boot_timeout}s")
    try:
        yield proc
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


# ──────────────────────────────────────────────────────────────────────
# section: Built-ins
# ──────────────────────────────────────────────────────────────────────


def section_builtins(run: TestRun) -> None:
    run.section("Built-ins")

    # B1 — --version
    code, stdout, stderr = run_swt(["--version"])
    if code == -1:
        run.failed("B1", "swt --version", "swt: command not found on PATH")
        return
    m = re.match(r"^swt (\d+\.\d+\.\d+)", stdout.strip())
    if code != 0 or not m:
        run.failed(
            "B1", "swt --version", f"exit={code} stdout={stdout!r} stderr={stderr!r}"
        )
    else:
        run.passed("B1", "swt --version", f"installed: {m.group(1)}")

    # B2 — --help lists registered commands
    code, stdout, _ = run_swt(["--help"])
    if code != 0:
        run.failed("B2", "swt --help", f"exit={code}")
    else:
        required = ["help", "version", "status", "doctor"]
        missing = [v for v in required if v not in stdout]
        if missing:
            run.failed("B2", "swt --help", f"missing verbs in help output: {missing}")
        else:
            run.passed(
                "B2", "swt --help", f"{len(stdout.splitlines())} lines, lists known verbs"
            )

    # B3 — `swt help` matches `--help`
    code, stdout_help_verb, _ = run_swt(["help"])
    if code != 0:
        run.failed("B3", "swt help (verb)", f"exit={code}")
    else:
        # Don't require byte-identical; just same general shape.
        if "help" in stdout_help_verb and "version" in stdout_help_verb:
            run.passed("B3", "swt help (verb)", "matches --help shape")
        else:
            run.failed(
                "B3",
                "swt help (verb)",
                f"output missing core verbs; got first 100 chars: {stdout_help_verb[:100]!r}",
            )

    # B4 — `swt version` matches `--version`
    code, stdout_version_verb, _ = run_swt(["version"])
    if code == 0 and stdout_version_verb.strip() == stdout.strip().splitlines()[0]:
        # First line of --version output should equal `swt version` output.
        pass
    code_a, ver_a, _ = run_swt(["--version"])
    code_b, ver_b, _ = run_swt(["version"])
    if code_a == 0 and code_b == 0 and ver_a.strip() == ver_b.strip():
        run.passed("B4", "swt version", "matches `swt --version`")
    else:
        run.failed(
            "B4",
            "swt version",
            f"--version={ver_a!r} vs version={ver_b!r}",
        )

    # B5 — doctor exits 0 and runs at least one environment check
    code, stdout, stderr = run_swt(["doctor"])
    if code != 0:
        run.failed("B5", "swt doctor", f"exit={code} stderr={stderr!r}")
    else:
        # Should mention at least Node or Codex in its output (specific to swt's doctor checks).
        if any(s in stdout.lower() for s in ["node", "codex", "version", "ok"]):
            run.passed("B5", "swt doctor", f"{len(stdout.splitlines())} lines, exits 0")
        else:
            run.failed(
                "B5",
                "swt doctor",
                f"output looks empty; first 200 chars: {stdout[:200]!r}",
            )


# ──────────────────────────────────────────────────────────────────────
# section: Local state
# ──────────────────────────────────────────────────────────────────────


def section_local_state(run: TestRun, cwd: str) -> None:
    run.section("Local state")

    # L1 — detect-phase JSON
    code, stdout, stderr = run_swt(["detect-phase"], cwd=cwd)
    if code != 0:
        run.failed("L1", "detect-phase (json)", f"exit={code} stderr={stderr!r}")
    else:
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError as e:
            run.failed("L1", "detect-phase (json)", f"non-JSON output: {e}")
        else:
            # Greenfield assertions: no project, no phases.
            if data.get("planning_dir_exists") is False and data.get("phase_count") == 0:
                run.passed(
                    "L1",
                    "detect-phase (json)",
                    "greenfield state correctly reported",
                )
            else:
                run.failed(
                    "L1",
                    "detect-phase (json)",
                    f"unexpected fields: {data}",
                )

    # L2 — detect-phase --bash-format
    code, stdout, stderr = run_swt(["detect-phase", "--bash-format"], cwd=cwd)
    if code != 0:
        run.failed(
            "L2",
            "detect-phase --bash-format",
            f"exit={code} stderr={stderr!r}",
        )
    else:
        if "planning_dir_exists=false" in stdout and "phase_count=0" in stdout:
            run.passed("L2", "detect-phase --bash-format", "key=value pairs emitted")
        else:
            run.failed(
                "L2",
                "detect-phase --bash-format",
                f"missing expected keys; got: {stdout[:200]!r}",
            )

    # L3 — config show lists known keys
    code, stdout, stderr = run_swt(["config", "show"], cwd=cwd)
    if code != 0:
        run.failed("L3", "config show", f"exit={code} stderr={stderr!r}")
    else:
        required_keys = ["effort", "autonomy"]
        missing = [k for k in required_keys if k not in stdout]
        if missing:
            run.failed("L3", "config show", f"missing keys: {missing}")
        else:
            run.passed("L3", "config show", f"{len(stdout.splitlines())} lines emitted")

    # L4 — config get / set round-trip
    code, before, _ = run_swt(["config", "get", "effort"], cwd=cwd)
    if code != 0:
        run.failed("L4", "config get", f"exit={code}")
    else:
        before = before.strip()
        target = "thorough" if before != "thorough" else "balanced"
        code_set, _, stderr_set = run_swt(
            ["config", "set", "effort", target], cwd=cwd
        )
        code_after, after, _ = run_swt(["config", "get", "effort"], cwd=cwd)
        if code_set != 0 or code_after != 0:
            run.failed(
                "L4",
                "config get/set",
                f"set_exit={code_set} stderr={stderr_set!r} get_exit={code_after}",
            )
        elif after.strip() == target:
            run.passed(
                "L4",
                "config get/set",
                f"round-trip: {before!r} → {target!r} ✓",
            )
        else:
            run.failed(
                "L4",
                "config get/set",
                f"set didn't stick; before={before!r} target={target!r} after={after.strip()!r}",
            )

    # L5 — config set creates .swt-planning/ if missing (regression guard for A6.c)
    fresh_dir = tempfile.mkdtemp(prefix="swt-idiot-l5-")
    try:
        code, _, stderr = run_swt(["config", "set", "effort", "balanced"], cwd=fresh_dir)
        if code != 0:
            run.failed(
                "L5",
                "config set creates .swt-planning",
                f"exit={code} stderr={stderr!r}",
            )
        elif os.path.isdir(os.path.join(fresh_dir, ".swt-planning")):
            run.passed(
                "L5",
                "config set creates .swt-planning",
                "directory was created on demand (no ENOENT)",
            )
        else:
            run.failed(
                "L5",
                "config set creates .swt-planning",
                "exit 0 but .swt-planning/ wasn't created",
            )
    finally:
        shutil.rmtree(fresh_dir, ignore_errors=True)

    # L6 — status (greenfield) exits non-zero without crashing
    code, stdout, stderr = run_swt(["status"], cwd=cwd)
    if code == 0:
        run.failed(
            "L6",
            "status (greenfield)",
            f"unexpected exit 0; status should fail outside a project",
        )
    elif code == 1 and ("no" in stdout.lower() or "no" in stderr.lower()):
        run.passed("L6", "status (greenfield)", f"exit={code}, no crash")
    elif code in (1, 65):
        # Either documented exit code is fine; just confirm the binary didn't blow up.
        run.passed("L6", "status (greenfield)", f"exit={code}, no crash")
    else:
        run.failed("L6", "status (greenfield)", f"unexpected exit {code}: {stderr!r}")

    # L7 — `swt init <name>` scaffolds the project
    init_dir = tempfile.mkdtemp(prefix="swt-idiot-l7-")
    try:
        code, stdout, stderr = run_swt(
            ["init", "idiot-test", "--description", "verification fixture"],
            cwd=init_dir,
        )
        if code != 0:
            run.failed(
                "L7",
                "init <name>",
                f"exit={code} stderr={stderr.strip()[:200]!r}",
            )
        else:
            planning = os.path.join(init_dir, ".swt-planning")
            project_md = os.path.join(planning, "PROJECT.md")
            state_md = os.path.join(planning, "STATE.md")
            phases_dir = os.path.join(planning, "phases")
            missing: list[str] = []
            if not os.path.isfile(project_md):
                missing.append("PROJECT.md")
            if not os.path.isfile(state_md):
                missing.append("STATE.md")
            if not os.path.isdir(phases_dir):
                missing.append("phases/")
            if missing:
                run.failed(
                    "L7",
                    "init <name>",
                    f"exit 0 but artifacts missing: {missing}",
                )
            else:
                run.passed(
                    "L7",
                    "init <name>",
                    "PROJECT.md + STATE.md + phases/ all created",
                )
    finally:
        shutil.rmtree(init_dir, ignore_errors=True)


# ──────────────────────────────────────────────────────────────────────
# section: CLI surface
# ──────────────────────────────────────────────────────────────────────


def section_cli_surface(
    run: TestRun,
    cwd: str,
    skip_watch: bool = False,
    skip_stubs: bool = False,
) -> None:
    run.section("CLI surface")

    # C1 — unknown verb returns USAGE_ERROR (64) with a hint on stderr
    code, _, stderr = run_swt(["nosuchverbever"], cwd=cwd)
    if code == 0:
        run.failed("C1", "unknown verb", "unexpected exit 0")
    elif "unknown" in stderr.lower() or "not found" in stderr.lower() or "help" in stderr.lower():
        run.passed("C1", "unknown verb", f"exit={code} with hint on stderr")
    else:
        run.failed(
            "C1",
            "unknown verb",
            f"exit={code} but stderr looks unhelpful: {stderr!r}",
        )

    # C2 — SWT_NO_DASHBOARD=1 prints help on no-args (escape hatch)
    env = dict(os.environ)
    env["SWT_NO_DASHBOARD"] = "1"
    try:
        result = subprocess.run(
            ["swt"], capture_output=True, text=True, timeout=10, env=env, cwd=cwd
        )
        if result.returncode == 0 and "version" in result.stdout and "status" in result.stdout:
            run.passed(
                "C2",
                "SWT_NO_DASHBOARD=1 swt",
                f"prints help ({len(result.stdout.splitlines())} lines)",
            )
        else:
            run.failed(
                "C2",
                "SWT_NO_DASHBOARD=1 swt",
                f"exit={result.returncode} stdout={result.stdout[:200]!r}",
            )
    except subprocess.TimeoutExpired:
        run.failed(
            "C2",
            "SWT_NO_DASHBOARD=1 swt",
            "timed out — escape hatch may not be wired (would have spawned dashboard)",
        )

    # C3 — `swt watch` starts and exits cleanly on SIGTERM
    if skip_watch:
        run.skipped("C3", "swt watch", "--skip-watch flag set")
    else:
        proc = subprocess.Popen(
            ["swt", "watch"],
            cwd=cwd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        time.sleep(2.0)  # let the TUI finish booting
        if proc.poll() is not None:
            # Watch crashed before we could kill it.
            stderr_bytes = proc.stderr.read() if proc.stderr else b""
            stderr = stderr_bytes.decode("utf-8", errors="replace")
            run.failed(
                "C3",
                "swt watch",
                f"crashed: {stderr.splitlines()[0] if stderr else 'no stderr'}",
            )
        else:
            proc.terminate()
            try:
                proc.wait(timeout=5)
                run.passed("C3", "swt watch", "starts and exits cleanly on SIGTERM")
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
                run.failed("C3", "swt watch", "did not exit within 5s of SIGTERM")

    # C4 — invalid flag rejected
    code, _, stderr = run_swt(["--this-flag-does-not-exist"], cwd=cwd)
    if code == 0:
        run.failed("C4", "invalid flag", "unexpected exit 0")
    elif code in (1, 64) and stderr.strip():
        run.passed("C4", "invalid flag", f"exit={code} with error on stderr")
    else:
        run.failed("C4", "invalid flag", f"exit={code} stderr={stderr!r}")

    # C5 — 21 stub verbs each return NOT_IMPLEMENTED cleanly
    # `init` was promoted to a real command in v1.7.0 (X-02 closure);
    # the stub list is intentionally 21, not 22.
    if skip_stubs:
        run.skipped("C5", "stub sweep", "--skip-stubs flag set")
        return
    stubs = [
        "plan",
        "execute",
        "qa",
        "map",
        "debug",
        "fix",
        "archive",
        "release",
        "resume",
        "pause",
        "audit",
        "assumptions",
        "research",
        "discuss",
        "phase",
        "todo",
        "skills",
        "whats-new",
        "uninstall",
        "worktree",
        "lease",
    ]
    failed_stubs: list[str] = []
    for verb in stubs:
        code, stdout, stderr = run_swt([verb], cwd=cwd, timeout=10)
        combined = stdout + stderr
        looks_stubby = (
            "not yet implemented" in combined.lower() or "roadmap" in combined.lower()
        )
        if code == 0:
            failed_stubs.append(f"{verb}: exited 0 (expected non-zero)")
        elif not looks_stubby:
            failed_stubs.append(f"{verb}: no NOT_IMPLEMENTED message (exit {code})")

    if failed_stubs:
        head = "\n".join(failed_stubs[:5])
        suffix = (
            f"\n... +{len(failed_stubs) - 5} more"
            if len(failed_stubs) > 5
            else ""
        )
        run.failed("C5", f"stub sweep ({len(stubs)} verbs)", head + suffix)
    else:
        run.passed(
            "C5",
            f"stub sweep ({len(stubs)} verbs)",
            f"all {len(stubs)} stubs return NOT_IMPLEMENTED cleanly",
        )


# ──────────────────────────────────────────────────────────────────────
# section: Network
# ──────────────────────────────────────────────────────────────────────


def section_network(run: TestRun) -> None:
    run.section("Network")

    code, stdout, stderr = run_swt(["update", "--json"], timeout=15)
    if code != 0:
        run.failed("N1", "swt update --json", f"exit={code} stderr={stderr!r}")
        return
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as e:
        run.failed("N1", "swt update --json", f"non-JSON output: {e}: {stdout[:200]!r}")
        return
    if "status" not in data:
        run.failed("N1", "swt update --json", f"missing 'status' field: {data}")
    else:
        run.passed("N1", "swt update --json", f"status: {data['status']}")


# ──────────────────────────────────────────────────────────────────────
# section: Dashboard HTTP
# ──────────────────────────────────────────────────────────────────────


def section_dashboard_http(run: TestRun, port: int) -> None:
    run.section("Dashboard HTTP")

    # Each test below uses its OWN tmpdir + daemon so we don't pick up state
    # from earlier sections (e.g., the `.swt-planning/` config-set created in
    # L4/L5 would make /api/snapshot return is_initialized=true).
    fresh = tempfile.mkdtemp(prefix="swt-idiot-d-")
    try:
        with dashboard_daemon(fresh, port):
            base = f"http://127.0.0.1:{port}"

            # D1 — /api/health
            try:
                health = http_get_json(f"{base}/api/health")
                ok = health.get("status") == "ok" and "uptime_ms" in health
                if ok:
                    daemon_v = health.get("daemon_version", "unknown")
                    run.passed(
                        "D1",
                        "/api/health",
                        f"status=ok schema_version={health.get('schema_version')} daemon_version={daemon_v}",
                    )
                else:
                    run.failed("D1", "/api/health", f"unexpected payload: {health}")
            except Exception as e:
                run.failed("D1", "/api/health", str(e))

            # D2 — /api/snapshot greenfield
            try:
                snap = http_get_json(f"{base}/api/snapshot")
                if snap.get("is_initialized") is False:
                    run.passed(
                        "D2",
                        "/api/snapshot greenfield",
                        "is_initialized=false ✓",
                    )
                else:
                    run.failed(
                        "D2",
                        "/api/snapshot greenfield",
                        f"expected is_initialized=false, got {snap.get('is_initialized')!r}",
                    )
            except Exception as e:
                run.failed("D2", "/api/snapshot greenfield", str(e))

            # D3 — GET / serves SPA HTML
            try:
                status, headers, body = http_get_raw(f"{base}/")
                ctype = headers.get("Content-Type", headers.get("content-type", ""))
                body_text = body.decode("utf-8", errors="replace")
                if status == 200 and "text/html" in ctype.lower() and "<html" in body_text.lower():
                    run.passed(
                        "D3",
                        "GET / serves SPA",
                        f"{status} {ctype.split(';')[0]} ({len(body)} bytes)",
                    )
                else:
                    run.failed(
                        "D3",
                        "GET / serves SPA",
                        f"status={status} ctype={ctype!r} body[0:120]={body_text[:120]!r}",
                    )
            except Exception as e:
                run.failed("D3", "GET / serves SPA", str(e))

            # D4 — POST /api/command literal verb
            try:
                status, resp = http_post_json(f"{base}/api/command", {"input": "version"})
                if status == 200 and resp.get("routing_decision") == "literal":
                    run.passed(
                        "D4",
                        "POST /api/command 'version'",
                        f"routing_decision=literal exit_code={resp.get('exit_code')}",
                    )
                else:
                    run.failed(
                        "D4",
                        "POST /api/command 'version'",
                        f"status={status} resp={resp}",
                    )
            except Exception as e:
                run.failed("D4", "POST /api/command 'version'", str(e))

            # D5 — POST /api/command interactive (rejected)
            try:
                status, resp = http_post_json(f"{base}/api/command", {"input": "vibe"})
                if status == 200 and resp.get("routing_decision") == "rejected_interactive":
                    run.passed(
                        "D5",
                        "POST /api/command 'vibe'",
                        "routing_decision=rejected_interactive ✓",
                    )
                else:
                    run.failed(
                        "D5",
                        "POST /api/command 'vibe'",
                        f"status={status} resp={resp}",
                    )
            except Exception as e:
                run.failed("D5", "POST /api/command 'vibe'", str(e))

            # D6 — POST /api/command unknown
            try:
                status, resp = http_post_json(
                    f"{base}/api/command",
                    {"input": "create a fake readme"},
                )
                if status == 200 and resp.get("routing_decision") == "rejected_unknown":
                    run.passed(
                        "D6",
                        "POST /api/command natural-language",
                        "routing_decision=rejected_unknown ✓",
                    )
                else:
                    run.failed(
                        "D6",
                        "POST /api/command natural-language",
                        f"status={status} resp={resp}",
                    )
            except Exception as e:
                run.failed("D6", "POST /api/command natural-language", str(e))

            # D7 — /api/config greenfield (v2.3)
            try:
                cfg = http_get_json(f"{base}/api/config")
                if (
                    cfg.get("is_initialized") is False
                    and cfg.get("source") == "default"
                    and isinstance(cfg.get("config"), dict)
                    and "effort" in cfg["config"]
                ):
                    run.passed(
                        "D7",
                        "/api/config greenfield",
                        f"is_initialized=false source=default effort={cfg['config'].get('effort')}",
                    )
                else:
                    run.failed(
                        "D7",
                        "/api/config greenfield",
                        f"unexpected payload: {cfg}",
                    )
            except Exception as e:
                run.failed("D7", "/api/config greenfield", str(e))

            # D8 — /api/doctor (v2.3)
            try:
                rep = http_get_json(f"{base}/api/doctor")
                raw_checks = rep.get("checks")
                checks_list: list = raw_checks if isinstance(raw_checks, list) else []
                overall = rep.get("overall_status")
                shape_ok = (
                    len(checks_list) >= 1
                    and overall in ("pass", "warn", "fail")
                    and all(
                        isinstance(c, dict)
                        and {"id", "name", "status", "detail"}.issubset(c.keys())
                        and c.get("status") in ("pass", "warn", "fail")
                        for c in checks_list
                    )
                )
                if shape_ok:
                    run.passed(
                        "D8",
                        "/api/doctor",
                        f"overall_status={overall} checks={len(checks_list)}",
                    )
                else:
                    run.failed(
                        "D8",
                        "/api/doctor",
                        f"unexpected payload: {rep}",
                    )
            except Exception as e:
                run.failed("D8", "/api/doctor", str(e))

            # D9 — /api/detect-phase greenfield (v2.3)
            try:
                dp = http_get_json(f"{base}/api/detect-phase")
                result = dp.get("result")
                if (
                    dp.get("is_initialized") is False
                    and isinstance(result, dict)
                    and result.get("project_exists") is False
                ):
                    run.passed(
                        "D9",
                        "/api/detect-phase greenfield",
                        "is_initialized=false project_exists=false ✓",
                    )
                else:
                    run.failed(
                        "D9",
                        "/api/detect-phase greenfield",
                        f"unexpected payload: {dp}",
                    )
            except Exception as e:
                run.failed("D9", "/api/detect-phase greenfield", str(e))

            # D10 — /api/update (v2.3)
            # Network may be unavailable → latest_version:null + non-null
            # error is the contract-correct degraded path. Only a 5xx /
            # malformed body fails the check.
            try:
                up = http_get_json(f"{base}/api/update")
                shape_ok = (
                    isinstance(up.get("current_version"), str)
                    and up.get("registry") == "npm"
                    and "update_available" in up
                    and "last_checked" in up
                    and "latest_version" in up
                    and "error" in up
                )
                happy = up.get("latest_version") is not None and up.get("error") is None
                degraded = up.get("latest_version") is None and up.get("error") is not None
                if shape_ok and (happy or degraded):
                    label = "happy" if happy else "degraded"
                    run.passed(
                        "D10",
                        "/api/update",
                        f"{label} current={up['current_version']} latest={up.get('latest_version')!r}",
                    )
                else:
                    run.failed(
                        "D10",
                        "/api/update",
                        f"unexpected payload: {up}",
                    )
            except Exception as e:
                run.failed("D10", "/api/update", str(e))

            # D11 — /api/commands (v2.3)
            try:
                reg = http_get_json(f"{base}/api/commands")
                raw_verbs = reg.get("verbs")
                verb_list: list = raw_verbs if isinstance(raw_verbs, list) else []
                shape_ok = len(verb_list) >= 1 and all(
                    isinstance(v, dict)
                    and {"name", "description", "usage", "category", "dashboard_safe"}.issubset(
                        v.keys()
                    )
                    for v in verb_list
                )
                has_doctor = shape_ok and any(v.get("name") == "doctor" for v in verb_list)
                if shape_ok and has_doctor:
                    run.passed(
                        "D11",
                        "/api/commands",
                        f"verbs={len(verb_list)} doctor present ✓",
                    )
                else:
                    run.failed(
                        "D11",
                        "/api/commands",
                        f"unexpected payload (verbs={len(verb_list)})",
                    )
            except Exception as e:
                run.failed("D11", "/api/commands", str(e))
    finally:
        shutil.rmtree(fresh, ignore_errors=True)


# ──────────────────────────────────────────────────────────────────────
# section: Dashboard vibe (v2.0)
# ──────────────────────────────────────────────────────────────────────


def section_dashboard_vibe(run: TestRun, port: int) -> None:
    run.section("Dashboard vibe (v2.0)")

    # V1 + V2 — default daemon (SWT_VIBE_AGENT unset)
    fresh = tempfile.mkdtemp(prefix="swt-idiot-v-")
    try:
        with dashboard_daemon(fresh, port):
            base = f"http://127.0.0.1:{port}"

            # V1 — POST /api/vibe returns agent_backend=none in default mode
            try:
                status, resp = http_post_json(
                    f"{base}/api/vibe", {"prompt": "build me a snake game"}
                )
                if status == 200 and "session_id" in resp and resp.get("agent_backend") == "none":
                    run.passed(
                        "V1",
                        "POST /api/vibe (default)",
                        f"agent_backend=none state={resp.get('state')!r}",
                    )
                elif status == 200 and "session_id" in resp:
                    run.failed(
                        "V1",
                        "POST /api/vibe (default)",
                        f"agent_backend not 'none': resp={resp}",
                    )
                else:
                    run.failed(
                        "V1",
                        "POST /api/vibe (default)",
                        f"status={status} resp={resp}",
                    )
            except Exception as e:
                run.failed("V1", "POST /api/vibe (default)", str(e))

            # V2 — POST /api/vibe/:bad-session/reply returns 404
            try:
                status, resp = http_post_json(
                    f"{base}/api/vibe/notarealsession/reply",
                    {
                        "prompt_id": "nope",
                        "answer": {"kind": "free_form", "text": "hi"},
                    },
                )
                if status == 404 and resp.get("error") == "session_not_found":
                    run.passed(
                        "V2",
                        "POST /api/vibe/:bad/reply",
                        "404 session_not_found ✓",
                    )
                else:
                    run.failed(
                        "V2",
                        "POST /api/vibe/:bad/reply",
                        f"status={status} resp={resp}",
                    )
            except Exception as e:
                run.failed("V2", "POST /api/vibe/:bad/reply", str(e))
    finally:
        shutil.rmtree(fresh, ignore_errors=True)

    # V3 — daemon with SWT_VIBE_AGENT=codex returns agent_backend=codex
    fresh2 = tempfile.mkdtemp(prefix="swt-idiot-v3-")
    port2 = find_free_port()
    try:
        with dashboard_daemon(
            fresh2,
            port2,
            env_overrides={"SWT_VIBE_AGENT": "codex"},
        ):
            base2 = f"http://127.0.0.1:{port2}"
            try:
                status, resp = http_post_json(
                    f"{base2}/api/vibe", {"prompt": "ignored — agent will fail without codex"}
                )
                if status == 200 and resp.get("agent_backend") == "codex":
                    run.passed(
                        "V3",
                        "SWT_VIBE_AGENT=codex daemon",
                        f"agent_backend=codex state={resp.get('state')!r}",
                    )
                else:
                    run.failed(
                        "V3",
                        "SWT_VIBE_AGENT=codex daemon",
                        f"status={status} resp={resp}",
                    )
            except Exception as e:
                run.failed("V3", "SWT_VIBE_AGENT=codex daemon", str(e))
    finally:
        shutil.rmtree(fresh2, ignore_errors=True)


# ──────────────────────────────────────────────────────────────────────
# section: Dashboard SSE
# ──────────────────────────────────────────────────────────────────────


def _check_sse_headers(url: str) -> tuple[int, str]:
    """Open an SSE connection just long enough to read response headers.

    Returns (status, content_type). Greenfield daemons emit no body bytes
    until the 30s heartbeat, so we deliberately do NOT read the body —
    headers are sufficient to verify the stream surface is up.
    """
    req = urllib.request.Request(url, headers={"accept": "text/event-stream"})
    resp = urllib.request.urlopen(req, timeout=3.0)
    try:
        return resp.status, resp.headers.get("Content-Type", "")
    finally:
        # Closing the response without reading is the right behavior — Hono's
        # SSE handler treats client disconnect as a clean close.
        resp.close()


def section_dashboard_sse(run: TestRun, port: int) -> None:
    run.section("Dashboard SSE")

    fresh = tempfile.mkdtemp(prefix="swt-idiot-e-")
    try:
        with dashboard_daemon(fresh, port):
            base = f"http://127.0.0.1:{port}"

            # E1 — /api/events returns text/event-stream
            try:
                status, ctype = _check_sse_headers(f"{base}/api/events")
                if status == 200 and "text/event-stream" in ctype:
                    run.passed(
                        "E1",
                        "GET /api/events",
                        f"{status} {ctype.split(';')[0]} (stream opened)",
                    )
                else:
                    run.failed(
                        "E1",
                        "GET /api/events",
                        f"status={status} ctype={ctype!r}",
                    )
            except Exception as e:
                run.failed("E1", "GET /api/events", str(e))

            # E2 — /api/events?session_id= filter accepts the param
            try:
                status, ctype = _check_sse_headers(
                    f"{base}/api/events?session_id=abc123"
                )
                if status == 200 and "text/event-stream" in ctype:
                    run.passed(
                        "E2",
                        "GET /api/events?session_id=...",
                        f"{status} {ctype.split(';')[0]} (filter accepted)",
                    )
                else:
                    run.failed(
                        "E2",
                        "GET /api/events?session_id=...",
                        f"status={status} ctype={ctype!r}",
                    )
            except Exception as e:
                run.failed("E2", "GET /api/events?session_id=...", str(e))
    finally:
        shutil.rmtree(fresh, ignore_errors=True)


# ──────────────────────────────────────────────────────────────────────
# main
# ──────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="SWT idiot check — comprehensive CLI mechanics smoke test.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="exits 0 (all green), 1 (one or more failed), 2 (script error)",
    )
    parser.add_argument(
        "--port", type=int, default=None, help="Dashboard port for HTTP/SSE/Vibe sections"
    )
    parser.add_argument(
        "--keep-test-dir",
        action="store_true",
        help="Don't delete the local-state tmpdir after the run (debug aid)",
    )
    parser.add_argument(
        "--skip-update", action="store_true", help="Skip Network section (faster offline runs)"
    )
    parser.add_argument(
        "--skip-watch", action="store_true", help="Skip the C3 watch check"
    )
    parser.add_argument(
        "--skip-stubs",
        action="store_true",
        help="Skip the C5 stub-verb sweep",
    )
    parser.add_argument(
        "--skip-dashboard",
        action="store_true",
        help="Skip Dashboard HTTP / Vibe / SSE sections",
    )
    parser.add_argument(
        "--no-color", action="store_true", help="Disable ANSI color output"
    )
    parser.add_argument(
        "--track-b-info",
        action="store_true",
        help="Print Track B (Codex-driven) manual smoke instructions and exit",
    )
    args = parser.parse_args()

    if args.track_b_info:
        print(_track_b_blurb())
        return 0

    use_color = _supports_color() and not args.no_color
    run = TestRun(color=use_color)

    print(run._wrap("━" * 60, BOLD))
    print(run._wrap("  SWT idiot check — Track A (no Codex tokens spent)", BOLD))
    print(run._wrap("━" * 60, BOLD))

    swt_path = shutil.which("swt")
    if not swt_path:
        run.section_name = "Pre-flight"
        run.failed("PRE", "swt on PATH", "swt: command not found on PATH")
        print()
        print(
            "  Run "
            f"{run._wrap('npm install -g stop-wasting-tokens', CYAN)}"
            " then re-run this script."
        )
        return 2
    print(f"  swt path:  {swt_path}")
    test_dir = tempfile.mkdtemp(prefix="swt-idiot-check-")
    print(f"  test dir:  {test_dir}")

    try:
        section_builtins(run)
        section_local_state(run, test_dir)
        section_cli_surface(
            run,
            test_dir,
            skip_watch=args.skip_watch,
            skip_stubs=args.skip_stubs,
        )

        if not args.skip_update:
            section_network(run)
        else:
            run.section("Network")
            run.skipped("N1", "swt update --json", "--skip-update flag set")

        if not args.skip_dashboard:
            port_http = args.port or find_free_port()
            section_dashboard_http(run, port_http)
            port_vibe = find_free_port()
            section_dashboard_vibe(run, port_vibe)
            port_sse = find_free_port()
            section_dashboard_sse(run, port_sse)
        else:
            run.section("Dashboard HTTP / Vibe / SSE")
            run.skipped("D*", "dashboard sections", "--skip-dashboard flag set")

    except KeyboardInterrupt:
        print()
        print(run._wrap("  ⚠ interrupted — cleaning up…", YELLOW))
        return 130
    finally:
        if not args.keep_test_dir:
            shutil.rmtree(test_dir, ignore_errors=True)
        else:
            print()
            print(f"  test dir kept at: {test_dir}")

    rc = run.summary()
    if rc == 0:
        print()
        print(run._wrap("  Track B (Codex-driven, ~30 min, ~50–150k tokens):", DIM))
        print(run._wrap("    Run `python3 idiot_check.py --track-b-info` for manual steps.", DIM))
    return rc


def _track_b_blurb() -> str:
    return """
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Track B — Codex-driven full vibe lifecycle
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Track A (this script) is mechanics-only. Track B exercises a real
methodology loop: real Codex CLI, real agent prompts, real tokens,
real artifact creation. Plan ~30 minutes of attended time and
~50–150k tokens of Codex spend.

Steps:

  1. mkdir hello-cli && cd hello-cli
  2. swt init hello-cli --description "tiny CLI tool for verification"
  3. swt status            (should show Phase 1 of N pending)
  4. SWT_VIBE_AGENT=codex swt
                            (opens dashboard; agent backend wired)
  5. In the dashboard command bar, type: 'add a hello command'
  6. Watch the agent emit ASK_USER markers (or run silent if the
     prompts haven't been updated yet); answer follow-ups in the
     chat panel.
  7. Once the agent completes, verify:
     - .swt-planning/phases/<NN>-<slug>/ contains PLAN.md + SUMMARY.md
     - The actual code change is on disk (e.g., new src/commands/hello.ts)
     - Permission prompts (if any) had the amber-shield treatment

Pass criteria for Track B:
  - The full Discuss → Plan → Execute → QA → Verify cycle ran.
  - At least one ASK_USER round-trip surfaced + got answered.
  - Permission gate triggered for at least one out-of-project or
    shell operation.
  - Daemon survived the run; no crashes.

Track B is intentionally manual because it requires human judgement
on the agent's question quality + the resulting code's correctness,
neither of which a smoke script can validate.
"""


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"\n{RED}{BOLD}script error:{RESET} {e}", file=sys.stderr)
        sys.exit(2)
