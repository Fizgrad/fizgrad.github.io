#!/usr/bin/env python3
"""Local runner for Linux/C++ systems-programming exercises.

The runner intentionally executes submitted code without a security sandbox.
Use it only with code you trust and run it inside a disposable container or VM
when stronger isolation is required.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = ROOT / "problems.json"
SUPPORT_DIR = ROOT / "support"
DEFAULT_WORKSPACE = Path.cwd() / "systems-lab-work"


class LabError(RuntimeError):
    pass


def runner_command() -> str:
    runner = ROOT / "practice.py"
    try:
        runner = runner.relative_to(Path.cwd())
    except ValueError:
        pass
    return f"python3 {shlex.quote(str(runner))}"


def load_manifest() -> dict[str, Any]:
    try:
        data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise LabError(f"cannot read {MANIFEST_PATH}: {error}") from error

    if data.get("version") != 1 or not isinstance(data.get("problems"), list):
        raise LabError("unsupported or malformed problem manifest")
    return data


def problem_map(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {problem["id"]: problem for problem in manifest["problems"]}


def require_problem(manifest: dict[str, Any], problem_id: str) -> dict[str, Any]:
    problem = problem_map(manifest).get(problem_id)
    if problem is None:
        available = ", ".join(sorted(problem_map(manifest)))
        raise LabError(f"unknown problem '{problem_id}'. Available: {available}")
    return problem


def localized(value: Any, lang: str) -> str:
    if isinstance(value, dict):
        return str(value.get(lang) or value.get("zh") or value.get("en") or "")
    return str(value)


def labels(manifest: dict[str, Any], group: str, key: str, lang: str) -> str:
    values = manifest.get(group, {})
    return localized(values.get(key, key), lang)


def format_problem(manifest: dict[str, Any], problem: dict[str, Any], lang: str) -> str:
    category = labels(manifest, "categories", problem["category"], lang)
    difficulty = labels(manifest, "difficulties", problem["difficulty"], lang)
    requirements = problem["requirements"][lang]
    checks = problem["checks"][lang]

    if lang == "en":
        headers = {
            "meta": "Metadata",
            "api": "Required API",
            "requirements": "Requirements",
            "checks": "Public checks",
            "commands": "Commands",
        }
    else:
        headers = {
            "meta": "基本信息",
            "api": "要求实现的 API",
            "requirements": "行为要求",
            "checks": "公开检查项",
            "commands": "常用命令",
        }

    lines = [
        f"# {localized(problem['title'], lang)}",
        "",
        localized(problem["summary"], lang),
        "",
        f"## {headers['meta']}",
        "",
        f"- Category: {category}",
        f"- Difficulty: {difficulty}",
        f"- Standard: {problem['standard']}",
        f"- Platform: {problem['platform']}",
        f"- Time limit: {problem['timeLimitMs']} ms",
        f"- Concepts: {', '.join(problem['concepts'])}",
        "",
        f"## {headers['api']}",
        "",
        "```cpp",
        problem["api"],
        "```",
        "",
        f"## {headers['requirements']}",
        "",
    ]
    lines.extend(f"{index}. {item}" for index, item in enumerate(requirements, 1))
    lines.extend(["", f"## {headers['checks']}", ""])
    lines.extend(f"- {item}" for item in checks)
    lines.extend(
        [
            "",
            f"## {headers['commands']}",
            "",
            "```bash",
            f"{runner_command()} init {problem['id']}",
            f"{runner_command()} run {problem['id']}",
            "```",
            "",
        ]
    )
    return "\n".join(lines)


def command_list(args: argparse.Namespace, manifest: dict[str, Any]) -> int:
    problems = manifest["problems"]
    if args.category:
        problems = [problem for problem in problems if problem["category"] == args.category]

    rows: list[tuple[str, str, str, str]] = []
    for problem in problems:
        rows.append(
            (
                problem["id"],
                labels(manifest, "categories", problem["category"], args.lang),
                labels(manifest, "difficulties", problem["difficulty"], args.lang),
                localized(problem["title"], args.lang),
            )
        )

    headers = ("ID", "CATEGORY", "LEVEL", "TITLE")
    widths = [len(header) for header in headers]
    for row in rows:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], len(value))

    print("  ".join(header.ljust(widths[index]) for index, header in enumerate(headers)))
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(value.ljust(widths[index]) for index, value in enumerate(row)))
    return 0


def command_show(args: argparse.Namespace, manifest: dict[str, Any]) -> int:
    print(format_problem(manifest, require_problem(manifest, args.problem_id), args.lang))
    return 0


def workspace_for(base: Path, problem_id: str) -> Path:
    return base.expanduser().resolve() / problem_id


def command_init(args: argparse.Namespace, manifest: dict[str, Any]) -> int:
    problem = require_problem(manifest, args.problem_id)
    destination = workspace_for(args.workspace, problem["id"])
    solution = destination / "solution.cpp"
    readme = destination / "README.md"

    destination.mkdir(parents=True, exist_ok=True)
    if solution.exists() and not args.force:
        raise LabError(f"{solution} already exists; use --force only if overwriting it is intentional")

    starter = ROOT / problem["starter"]
    if not starter.is_file():
        raise LabError(f"starter file is missing: {starter}")

    shutil.copyfile(starter, solution)
    readme.write_text(format_problem(manifest, problem, args.lang), encoding="utf-8")
    print(f"initialized: {destination}")
    print(f"edit:        {solution}")
    print(f"run:         {runner_command()} run {problem['id']}")
    return 0


def compiler_command(
    compiler: str,
    test_file: Path,
    build_dir: Path,
    sanitizer: str,
    verbose: bool,
) -> tuple[list[str], Path]:
    compiler_path = shutil.which(compiler)
    if compiler_path is None:
        raise LabError(f"compiler not found: {compiler}")

    binary = build_dir / "systems-lab-test"
    command = [
        compiler_path,
        "-std=c++20",
        "-Wall",
        "-Wextra",
        "-Wpedantic",
        "-pthread",
        "-g",
        str(test_file),
        "-I",
        str(build_dir),
        "-I",
        str(SUPPORT_DIR),
        "-o",
        str(binary),
    ]

    if sanitizer == "none":
        command.extend(["-O2"])
    elif sanitizer == "address":
        command.extend(["-O1", "-fno-omit-frame-pointer", "-fsanitize=address,undefined"])
    elif sanitizer == "undefined":
        command.extend(["-O1", "-fno-omit-frame-pointer", "-fsanitize=undefined"])
    elif sanitizer == "thread":
        command.extend(["-O1", "-fno-omit-frame-pointer", "-fsanitize=thread"])
    else:
        raise LabError(f"unsupported sanitizer: {sanitizer}")

    if verbose:
        print("compile:", " ".join(command))
    return command, binary


def run_with_timeout(
    command: list[str],
    timeout_seconds: float,
    environment: dict[str, str] | None = None,
) -> tuple[int, str, bool, float]:
    started = time.monotonic()
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=environment,
        start_new_session=True,
    )
    try:
        output, _ = process.communicate(timeout=timeout_seconds)
        return process.returncode, output, False, time.monotonic() - started
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        output, _ = process.communicate()
        return 124, output, True, time.monotonic() - started


def test_solution(
    problem: dict[str, Any],
    solution: Path,
    compiler: str,
    sanitizer: str,
    repeat: int,
    verbose: bool,
) -> bool:
    if not solution.is_file():
        raise LabError(f"solution file does not exist: {solution}")

    test_file = ROOT / problem["tests"]
    if not test_file.is_file():
        raise LabError(f"test file is missing: {test_file}")

    with tempfile.TemporaryDirectory(prefix=f"systems-lab-{problem['id']}-") as temporary:
        build_dir = Path(temporary)
        shutil.copyfile(solution, build_dir / "solution.cpp")
        compile_command, binary = compiler_command(
            compiler, test_file, build_dir, sanitizer, verbose
        )

        compile_result = subprocess.run(
            compile_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=60,
            check=False,
        )
        if compile_result.stdout:
            print(compile_result.stdout, end="" if compile_result.stdout.endswith("\n") else "\n")
        if compile_result.returncode != 0:
            print(f"[COMPILE FAILED] exit code {compile_result.returncode}")
            return False

        environment = os.environ.copy()
        if sanitizer == "address":
            environment.setdefault("ASAN_OPTIONS", "detect_leaks=1:abort_on_error=1")
        elif sanitizer == "undefined":
            environment.setdefault("UBSAN_OPTIONS", "halt_on_error=1:print_stacktrace=1")
        elif sanitizer == "thread":
            environment.setdefault("TSAN_OPTIONS", "halt_on_error=1")

        timeout_seconds = problem["timeLimitMs"] / 1000.0
        for iteration in range(1, repeat + 1):
            if repeat > 1:
                print(f"\n[RUN {iteration}/{repeat}]")
            return_code, output, timed_out, elapsed = run_with_timeout(
                [str(binary)], timeout_seconds, environment
            )
            if output:
                print(output, end="" if output.endswith("\n") else "\n")
            if timed_out:
                print(
                    f"[TIMEOUT] exceeded {problem['timeLimitMs']} ms; "
                    "possible deadlock, missed wakeup, or blocking I/O"
                )
                return False
            if return_code != 0:
                print(f"[FAILED] exit code {return_code}, elapsed {elapsed:.3f} s")
                return False
            if verbose:
                print(f"[OK] elapsed {elapsed:.3f} s")
        return True


def command_run(args: argparse.Namespace, manifest: dict[str, Any]) -> int:
    problem = require_problem(manifest, args.problem_id)
    if args.solution:
        solution = args.solution.expanduser().resolve()
    else:
        solution = workspace_for(args.workspace, problem["id"]) / "solution.cpp"

    print("warning: submitted C++ runs locally without a security sandbox")
    success = test_solution(
        problem,
        solution,
        args.compiler,
        args.sanitizer,
        args.repeat,
        args.verbose,
    )
    if success:
        print(f"\n[PASS] {problem['id']}")
        return 0
    return 1


def command_self_test(args: argparse.Namespace, manifest: dict[str, Any]) -> int:
    selected: Iterable[dict[str, Any]] = manifest["problems"]
    if args.problem_id:
        selected = [require_problem(manifest, args.problem_id)]

    passed = 0
    failed: list[str] = []
    for problem in selected:
        print(f"\n=== {problem['id']} ===")
        reference = ROOT / problem["reference"]
        try:
            ok = test_solution(
                problem,
                reference,
                args.compiler,
                args.sanitizer,
                args.repeat,
                args.verbose,
            )
        except (LabError, subprocess.TimeoutExpired) as error:
            print(f"[ERROR] {error}")
            ok = False
        if ok:
            passed += 1
        else:
            failed.append(problem["id"])

    total = len(manifest["problems"]) if not args.problem_id else 1
    print(f"\nself-test: {passed}/{total} passed")
    if failed:
        print("failed:", ", ".join(failed))
        return 1
    return 0


def command_doctor(args: argparse.Namespace, manifest: dict[str, Any]) -> int:
    del manifest
    checks = [
        ("platform", platform.system(), platform.system() == "Linux"),
        ("python", platform.python_version(), sys.version_info >= (3, 9)),
        ("compiler", shutil.which(args.compiler) or "not found", shutil.which(args.compiler) is not None),
        ("/proc/self/fd", "available" if Path("/proc/self/fd").is_dir() else "missing", Path("/proc/self/fd").is_dir()),
    ]
    failed = False
    for name, detail, ok in checks:
        print(f"[{'OK' if ok else 'FAIL'}] {name}: {detail}")
        failed = failed or not ok
    return 1 if failed else 0


def add_common_test_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--compiler", default=os.environ.get("CXX", "g++"))
    parser.add_argument(
        "--sanitizer",
        choices=("none", "address", "undefined", "thread"),
        default="none",
    )
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--verbose", action="store_true")


def build_parser(manifest: dict[str, Any]) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compile and test Linux/C++ systems-programming exercises."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="list available exercises")
    list_parser.add_argument("--lang", choices=("zh", "en"), default="zh")
    list_parser.add_argument("--category", choices=tuple(manifest["categories"]))
    list_parser.set_defaults(handler=command_list)

    show_parser = subparsers.add_parser("show", help="show one exercise")
    show_parser.add_argument("problem_id")
    show_parser.add_argument("--lang", choices=("zh", "en"), default="zh")
    show_parser.set_defaults(handler=command_show)

    init_parser = subparsers.add_parser("init", help="create an editable solution workspace")
    init_parser.add_argument("problem_id")
    init_parser.add_argument("--workspace", type=Path, default=DEFAULT_WORKSPACE)
    init_parser.add_argument("--lang", choices=("zh", "en"), default="zh")
    init_parser.add_argument("--force", action="store_true")
    init_parser.set_defaults(handler=command_init)

    run_parser = subparsers.add_parser("run", help="compile and test a solution")
    run_parser.add_argument("problem_id")
    run_parser.add_argument("--workspace", type=Path, default=DEFAULT_WORKSPACE)
    run_parser.add_argument("--solution", type=Path)
    add_common_test_arguments(run_parser)
    run_parser.set_defaults(handler=command_run)

    self_test_parser = subparsers.add_parser(
        "self-test", help="run the bundled reference implementations"
    )
    self_test_parser.add_argument("problem_id", nargs="?")
    add_common_test_arguments(self_test_parser)
    self_test_parser.set_defaults(handler=command_self_test)

    doctor_parser = subparsers.add_parser("doctor", help="check local prerequisites")
    doctor_parser.add_argument("--compiler", default=os.environ.get("CXX", "g++"))
    doctor_parser.set_defaults(handler=command_doctor)
    return parser


def main() -> int:
    try:
        manifest = load_manifest()
        parser = build_parser(manifest)
        args = parser.parse_args()
        if hasattr(args, "repeat") and args.repeat < 1:
            parser.error("--repeat must be at least 1")
        return int(args.handler(args, manifest))
    except subprocess.TimeoutExpired:
        print("error: compiler timed out", file=sys.stderr)
        return 2
    except LabError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
