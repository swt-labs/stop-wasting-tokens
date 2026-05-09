#!/usr/bin/env python3
"""
SWT idiot check — automates Track A of idiot_check.md.

What this script does:
  - Verifies a fresh `npm i -g stop-wasting-tokens` install actually works.
  - Runs every Track A check from the companion idiot_check.md doc:
      A1 --version / --help          (built-ins)
      A2 help                         (registry surface)
      A3 version
      A4 doctor
      A5 detect-phase                 (JSON + --bash-format)
      A6 config show / get / set      (round-trip)
      A7 status                       (greenfield)
      A8 update --json
      A9 dashboard                    (boot, curl /api/health, /api/snapshot,
                                       /api/command × 3 routing decisions, kill)
      A10 watch                       (best-effort: starts without crashing)
      A11 stub sweep                  (all 21 stubs return EXIT.NOT_IMPLEMENTED)

What this script does NOT do:
  - Track B (full vibe lifecycle on a hello-cli project) is interactive —
    requires Codex CLI + AskUserQuestion CHECKPOINT loop responses. Run
    those steps manually per idiot_check.md after Track A passes.
  - Browser-side dashboard UI checks (the InitScreen → 4-panel transition,
    command-bar hint chips). Those are eyes-on; this script only exercises
    the HTTP contract.

Exit codes:
  0  — all checks pass
  1  — one or more checks failed
  2  — script error (swt not on PATH, etc.)

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

# ---------- output helpers ----------

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def _supports_color() -> bool:
    return sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


# ---------- result tracking ----------


@dataclass
class Result:
    name: str
    status: str  # "pass" | "fail" | "skip"
    detail: str = ""


@dataclass
class TestRun:
    results: list[Result] = field(default_factory=list)
    color: bool = True

    def _wrap(self, text: str, code: str) -> str:
        return f"{code}{text}{RESET}" if self.color else text

    def _print(self, symbol: str, code: str, name: str, detail: str = "") -> None:
        sym = self._wrap(symbol, code)
        print(f"  {sym} {name}")
        if detail:
            for line in detail.splitlines():
                print(f"      {self._wrap(line, DIM)}")

    def passed(self, name: str, detail: str = "") -> None:
        self.results.append(Result(name, "pass", detail))
        self._print("✓", GREEN, name, detail)

    def failed(self, name: str, detail: str) -> None:
        self.results.append(Result(name, "fail", detail))
        self._print("✗", RED, name, detail)

    def skipped(self, name: str, detail: str) -> None:
        self.results.append(Result(name, "skip", detail))
        self._print("○", YELLOW, name, detail)

    def section(self, title: str) -> None:
        bar = "─" * 60
        print()
        print(self._wrap(bar, BOLD))
        print(self._wrap(f"  {title}", BOLD))
        print(self._wrap(bar, BOLD))

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
                    print(f"    - {r.name}: {r.detail.splitlines()[0] if r.detail else ''}")
            return 1
        return 0


# ---------- subprocess helpers ----------


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


# ---------- HTTP helpers (stdlib only) ----------


def http_get_json(url: str, timeout: float = 5.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_post_command(port: int, input_text: str, timeout: float = 5.0) -> dict:
    body = json.dumps({"input": input_text}).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/command",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


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
def dashboard_daemon(cwd: str, port: int) -> Iterator[subprocess.Popen]:
    """Boot `swt dashboard` in the background; yield the Popen; SIGTERM on exit.

    Waits up to 15s for /api/health to respond before yielding.
    """
    proc = subprocess.Popen(
        ["swt", "dashboard", "--no-open", f"--port={port}"],
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            stderr = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
            raise RuntimeError(f"daemon exited early (code {proc.returncode}): {stderr}")
        try:
            data = http_get_json(f"http://127.0.0.1:{port}/api/health", timeout=1.0)
            if data.get("status") == "ok":
                break
        except (urllib.error.URLError, ConnectionError, json.JSONDecodeError):
            time.sleep(0.3)
    else:
        proc.terminate()
        raise RuntimeError(f"daemon failed to respond on port {port} within 15s")
    try:
        yield proc
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


# ---------- checks ----------


def check_a1_builtins(run: TestRun) -> None:
    """A1: --version, --help."""
    code, stdout, stderr = run_swt(["--version"])
    if code == -1:
        run.failed("A1.a swt --version", "swt: command not found on PATH")
        return
    m = re.match(r"^swt (\d+\.\d+\.\d+)", stdout.strip())
    if code != 0 or not m:
        run.failed("A1.a swt --version", f"exit={code} stdout={stdout!r} stderr={stderr!r}")
    else:
        run.passed("A1.a swt --version", f"installed: {m.group(1)}")

    code, stdout, _ = run_swt(["--help"])
    if code != 0 or "swt" not in stdout.lower():
        run.failed("A1.b swt --help", f"exit={code}, output looks empty/wrong")
    else:
        run.passed("A1.b swt --help", f"{len(stdout.splitlines())} lines emitted")


def check_a2_help(run: TestRun) -> None:
    """A2: swt help — verify registry surface lists working commands."""
    code, stdout, _ = run_swt(["help"])
    if code != 0:
        run.failed("A2 swt help", f"exit={code}")
        return
    expected = ["vibe", "status", "doctor", "detect-phase", "dashboard", "watch", "update", "config"]
    missing = [v for v in expected if not re.search(rf"\b{re.escape(v)}\b", stdout)]
    if missing:
        run.failed("A2 swt help", f"missing verbs in help output: {missing}")
    else:
        run.passed("A2 swt help", f"all {len(expected)} working verbs present")


def check_a3_version(run: TestRun) -> None:
    """A3: swt version (subcommand form should match --version)."""
    code1, stdout1, _ = run_swt(["version"])
    code2, stdout2, _ = run_swt(["--version"])
    if code1 != 0 or code2 != 0:
        run.failed("A3 swt version", f"exit codes: {code1} / {code2}")
        return
    if stdout1.strip() != stdout2.strip():
        run.failed(
            "A3 swt version",
            f"`swt version` ({stdout1.strip()!r}) != `swt --version` ({stdout2.strip()!r})",
        )
    else:
        run.passed("A3 swt version", "matches `swt --version`")


def check_a4_doctor(run: TestRun) -> None:
    """A4: swt doctor — runs prereq checks; treat any zero-exit as a pass.

    Codex CLI may be missing on Track-A-only machines; that's fine for this
    smoke test. We only fail if `doctor` itself crashes (non-zero exit + no
    structured output).
    """
    code, stdout, stderr = run_swt(["doctor"])
    if code == 0:
        run.passed("A4 swt doctor", f"green ({len(stdout.splitlines())} lines)")
    elif code == 1 and ("⚠" in stdout or "warning" in stdout.lower() or "missing" in stdout.lower()):
        run.passed("A4 swt doctor", "warnings present but doctor itself OK (Codex may be missing)")
    else:
        run.failed("A4 swt doctor", f"exit={code} stdout={stdout!r} stderr={stderr!r}")


def check_a5_detect_phase(run: TestRun, cwd: str) -> None:
    """A5: detect-phase JSON + --bash-format from greenfield cwd."""
    code, stdout, stderr = run_swt(["detect-phase"], cwd=cwd)
    if code != 0:
        run.failed("A5.a swt detect-phase (json)", f"exit={code} stderr={stderr!r}")
    else:
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError as e:
            # Some builds emit non-JSON when no project. Try bash-format.
            run.failed("A5.a swt detect-phase (json)", f"non-JSON output: {e}: {stdout[:200]!r}")
        else:
            if data.get("planning_dir_exists") is False or data.get("phase_count") == 0:
                run.passed("A5.a swt detect-phase (json)", "greenfield state correctly reported")
            else:
                run.passed(
                    "A5.a swt detect-phase (json)",
                    f"json parsed; planning_dir_exists={data.get('planning_dir_exists')}",
                )

    code, stdout, _ = run_swt(["detect-phase", "--bash-format"], cwd=cwd)
    if code != 0:
        run.failed("A5.b swt detect-phase --bash-format", f"exit={code}")
    elif "phase_detect_complete=true" not in stdout and "phase_count=" not in stdout:
        run.failed("A5.b swt detect-phase --bash-format", f"output missing key=value pairs: {stdout[:200]!r}")
    else:
        run.passed("A5.b swt detect-phase --bash-format", "key=value output emitted")


def check_a6_config(run: TestRun, cwd: str) -> None:
    """A6: config show / get / set round-trip."""
    code, stdout, stderr = run_swt(["config", "show"], cwd=cwd)
    if code != 0:
        run.failed("A6.a swt config show", f"exit={code} stderr={stderr!r}")
    elif not stdout.strip():
        run.failed("A6.a swt config show", "empty output")
    else:
        run.passed("A6.a swt config show", f"{len(stdout.splitlines())} lines emitted")

    # Pick a key that's safe to round-trip — `effort` exists in the default
    # config schema and accepts the same values we'd write.
    code, stdout, _ = run_swt(["config", "get", "effort"], cwd=cwd)
    if code != 0:
        run.failed("A6.b swt config get effort", f"exit={code}")
        return
    original = stdout.strip()

    # Set to a different value, get it back, restore the original.
    new_value = "balanced" if original != "balanced" else "thorough"
    code, _, stderr = run_swt(["config", "set", "effort", new_value], cwd=cwd)
    if code != 0:
        run.failed("A6.c swt config set", f"exit={code} stderr={stderr!r}")
        return
    code, stdout, _ = run_swt(["config", "get", "effort"], cwd=cwd)
    got = stdout.strip()
    if code != 0 or got != new_value:
        run.failed("A6.d round-trip", f"set {new_value} but get returned {got!r}")
    else:
        run.passed("A6 swt config show/get/set", f"round-trip: {original} → {new_value} ✓")
    # Restore original
    run_swt(["config", "set", "effort", original], cwd=cwd)


def check_a7_status(run: TestRun, cwd: str) -> None:
    """A7: swt status from greenfield (must NOT crash)."""
    code, _, stderr = run_swt(["status"], cwd=cwd)
    # Greenfield status may exit 0 or 1 depending on impl; what we care about
    # is that it doesn't crash with a stack trace.
    if "Traceback" in stderr or "TypeError" in stderr or "ReferenceError" in stderr:
        run.failed("A7 swt status (greenfield)", f"crashed: {stderr.splitlines()[0]}")
    elif code in (0, 1):
        run.passed("A7 swt status (greenfield)", f"exit={code}, no crash")
    else:
        run.failed("A7 swt status", f"unexpected exit {code}: {stderr!r}")


def check_a8_update(run: TestRun) -> None:
    """A8: swt update --json — should return a status field."""
    code, stdout, stderr = run_swt(["update", "--json"], timeout=15)
    if code != 0:
        run.failed("A8 swt update --json", f"exit={code} stderr={stderr!r}")
        return
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as e:
        run.failed("A8 swt update --json", f"non-JSON output: {e}: {stdout[:200]!r}")
        return
    if "status" not in data:
        run.failed("A8 swt update --json", f"missing 'status' field: {data}")
    else:
        run.passed("A8 swt update --json", f"status: {data['status']}")


def check_a9_dashboard(run: TestRun, cwd: str, port: int) -> None:
    """A9: dashboard boot + /api/health + /api/snapshot + /api/command × 3."""
    try:
        with dashboard_daemon(cwd, port):
            # /api/health
            try:
                health = http_get_json(f"http://127.0.0.1:{port}/api/health")
                if health.get("status") == "ok" and "uptime_ms" in health:
                    run.passed("A9.a /api/health", f"status=ok schema_version={health.get('schema_version')}")
                else:
                    run.failed("A9.a /api/health", f"unexpected payload: {health}")
            except Exception as e:
                run.failed("A9.a /api/health", str(e))

            # /api/snapshot — greenfield
            try:
                snap = http_get_json(f"http://127.0.0.1:{port}/api/snapshot")
                if snap.get("is_initialized") is False:
                    run.passed("A9.b /api/snapshot (greenfield)", "is_initialized=false ✓")
                else:
                    run.failed(
                        "A9.b /api/snapshot (greenfield)",
                        f"expected is_initialized=false, got {snap.get('is_initialized')!r}",
                    )
            except Exception as e:
                run.failed("A9.b /api/snapshot (greenfield)", str(e))

            # /api/command × 3 routing decisions
            cases = [
                ("A9.c POST /api/command 'version'", "version", "literal"),
                ("A9.d POST /api/command 'vibe'", "vibe", "rejected_interactive"),
                ("A9.e POST /api/command 'create a fake readme'", "create a fake readme", "rejected_unknown"),
            ]
            for name, input_text, expected_decision in cases:
                try:
                    resp = http_post_command(port, input_text)
                    got = resp.get("routing_decision")
                    if got == expected_decision:
                        run.passed(name, f"routing_decision={got} ✓")
                    else:
                        run.failed(
                            name,
                            f"expected routing_decision={expected_decision!r}, got {got!r} (full: {resp})",
                        )
                except Exception as e:
                    run.failed(name, str(e))
    except RuntimeError as e:
        run.failed("A9 dashboard boot", str(e))


def check_a10_watch(run: TestRun, cwd: str) -> None:
    """A10: swt watch — best-effort sanity. Verify it starts without crashing.

    `swt watch` is an Ink TUI; it requires a TTY. Without one, it should exit
    cleanly with a usage error rather than a stack trace. We Popen it for ~2s
    then SIGTERM and check stderr for Python/Node-style stack frames.
    """
    proc = subprocess.Popen(
        ["swt", "watch"],
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        time.sleep(2.0)
        proc.terminate()
        try:
            stderr = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
        except Exception:
            stderr = ""
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        run.failed("A10 swt watch", "didn't respond to SIGTERM within 5s")
        return

    bad_markers = [
        "Traceback (most recent call last)",
        "UnhandledPromiseRejection",
        "node:internal/",
        "TypeError: Cannot read",
    ]
    if any(marker in stderr for marker in bad_markers):
        run.failed("A10 swt watch", f"crashed: {stderr.splitlines()[0]}")
    else:
        run.passed("A10 swt watch", "starts and exits cleanly on SIGTERM")


def check_a11_stubs(run: TestRun, cwd: str) -> None:
    """A11: every stub returns NOT_IMPLEMENTED with a roadmap pointer.

    NOTE: `init` was promoted to a real command in v1.7.0 (X-02 closure),
    so it's no longer in the stub list. 21 stubs remain.
    """
    stubs = [
        "plan", "execute", "qa", "map", "debug", "fix", "archive",
        "release", "resume", "pause", "audit", "assumptions", "research",
        "discuss", "phase", "todo", "skills", "whats-new", "uninstall",
        "worktree", "lease",
    ]
    failed_stubs: list[str] = []
    for verb in stubs:
        code, stdout, stderr = run_swt([verb], cwd=cwd, timeout=10)
        combined = stdout + stderr
        # The stub message lives in either stdout or stderr depending on impl.
        # We accept any non-zero exit + a NOT_IMPLEMENTED-style message.
        looks_stubby = (
            "not yet implemented" in combined.lower()
            or "roadmap" in combined.lower()
        )
        if code == 0:
            failed_stubs.append(f"{verb}: exited 0 (expected non-zero)")
        elif not looks_stubby:
            failed_stubs.append(f"{verb}: no NOT_IMPLEMENTED message (exit {code})")

    label = f"A11 stub sweep ({len(stubs)} verbs)"
    if failed_stubs:
        run.failed(label, "\n".join(failed_stubs[:5]) + (f"\n... +{len(failed_stubs)-5} more" if len(failed_stubs) > 5 else ""))
    else:
        run.passed(label, f"all {len(stubs)} stubs return NOT_IMPLEMENTED cleanly")


# ---------- main ----------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="SWT idiot check — Track A automation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI colors")
    parser.add_argument(
        "--keep-test-dir",
        action="store_true",
        help="Don't remove the temp test directory after running",
    )
    parser.add_argument("--port", type=int, default=None, help="Dashboard port (default: auto)")
    parser.add_argument("--skip-watch", action="store_true", help="Skip the swt watch check")
    parser.add_argument("--skip-stubs", action="store_true", help="Skip the stub sweep")
    parser.add_argument("--skip-update", action="store_true", help="Skip swt update (network)")
    parser.add_argument("--track-b-info", action="store_true", help="Print Track B (Codex) instructions and exit")
    args = parser.parse_args()

    if args.track_b_info:
        print(_track_b_blurb())
        return 0

    color = not args.no_color and _supports_color()
    run = TestRun(color=color)

    print(run._wrap("━" * 60, BOLD))
    print(run._wrap("  SWT idiot check — Track A (no Codex tokens spent)", BOLD))
    print(run._wrap("━" * 60, BOLD))

    swt_path = shutil.which("swt")
    if not swt_path:
        run.failed("PATH check", "swt: command not found on PATH")
        print()
        print("  Run `npm install -g stop-wasting-tokens` then re-run this script.")
        return 2
    print(f"  swt path:  {swt_path}")
    test_dir = tempfile.mkdtemp(prefix="swt-idiot-check-")
    print(f"  test dir:  {test_dir}")

    try:
        run.section("A1–A4 — Built-ins, help, version, doctor")
        check_a1_builtins(run)
        check_a2_help(run)
        check_a3_version(run)
        check_a4_doctor(run)

        run.section("A5–A7 — Local-state helpers (greenfield cwd)")
        check_a5_detect_phase(run, test_dir)
        check_a6_config(run, test_dir)
        check_a7_status(run, test_dir)

        if args.skip_update:
            run.skipped("A8 swt update --json", "--skip-update flag set")
        else:
            run.section("A8 — Network update check")
            check_a8_update(run)

        run.section("A9 — Dashboard daemon + HTTP contract")
        port = args.port or find_free_port()
        # A6 created `.swt-planning/` in test_dir (post-X-02). For A9.b's
        # "greenfield /api/snapshot" check we need a fresh dir without
        # `.swt-planning/`.
        a9_dir = tempfile.mkdtemp(prefix="swt-idiot-check-a9-")
        try:
            check_a9_dashboard(run, a9_dir, port)
        finally:
            shutil.rmtree(a9_dir, ignore_errors=True)

        if args.skip_watch:
            run.skipped("A10 swt watch", "--skip-watch flag set")
        else:
            run.section("A10 — Ink TUI sanity")
            check_a10_watch(run, test_dir)

        if args.skip_stubs:
            run.skipped("A11 stub sweep (21 verbs)", "--skip-stubs flag set")
        else:
            run.section("A11 — Stub-verb sweep (21 commands)")
            check_a11_stubs(run, test_dir)

    except KeyboardInterrupt:
        print()
        print(run._wrap("  ⚠ interrupted — cleaning up…", YELLOW))
        return 130
    finally:
        if not args.keep_test_dir:
            shutil.rmtree(test_dir, ignore_errors=True)
        else:
            print()
            print(run._wrap(f"  test dir kept: {test_dir}", DIM))

    code = run.summary()
    if code == 0:
        print()
        print(run._wrap("  Track B (Codex-driven, ~30 min, ~50–150k tokens):", BOLD))
        print("    Run `python3 idiot_check.py --track-b-info` for the manual steps.")
    return code


def _track_b_blurb() -> str:
    return """\
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Track B — Deep pass (manual; requires Codex CLI auth)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This track exercises the full SWT methodology pipeline (vibe → discuss
→ plan → execute → verify → archive) on a tiny `hello-cli` project.
It cannot be automated cleanly because:

  - Codex CLI requires interactive auth (`codex auth`)
  - The UAT phase loops AskUserQuestion CHECKPOINTs that need human
    judgment (pass/fail per success criterion)
  - Token spend is non-trivial (~50–150k tokens) — running it in CI
    would be expensive

Steps to run manually (~30 min):

  1. Confirm Codex auth:           codex auth
  2. cd to a fresh empty dir:      mkdir -p ~/swt-test/hello-cli
                                   cd ~/swt-test/hello-cli
  3. Bootstrap + scope:            swt vibe
     (project name: hello-cli;
      core purpose: A CLI that prints a personalized greeting;
      scope: One phase. One plan. Build hello.js with --name flag,
             default 'world'.)

  4. Plan + execute Phase 01:      swt vibe
     (Scout → Lead → Dev pipeline produces hello.js)

  5. Verify the artifact:          node hello.js
                                   node hello.js --name Alice
     (expect "Hello, world!" and "Hello, Alice!")

  6. Auto-UAT CHECKPOINT loop:     swt vibe
     (mark each CHECKPOINT pass/fail via the AskUserQuestion prompt)

  7. Archive:                      swt vibe
     (moves artifacts to .swt-planning/milestones/01-{slug}/)

See a_non_production_files/idiot_check.md for the full Track B
verification matrix and pass/fail criteria.
"""


if __name__ == "__main__":
    sys.exit(main())
