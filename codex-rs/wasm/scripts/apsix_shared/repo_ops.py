from __future__ import annotations

import contextlib
import fcntl
import os
import subprocess
from pathlib import Path
from typing import Any

from .common import ApsixError


REPO_LOCK_NAME = ".spawn/repo.lock"


def detect_git_root(path: Path) -> Path:
    current = path.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists():
            return candidate
    raise ApsixError("pre", f"No git repository found above {path}")


def resolve_workspace(path_str: str | None) -> Path:
    raw = Path(path_str).expanduser() if path_str else Path.cwd()
    resolved = raw.resolve()
    if not resolved.exists():
        raise ApsixError("pre", f"Workspace does not exist: {resolved}")
    if not resolved.is_dir():
        raise ApsixError("pre", f"Workspace is not a directory: {resolved}")
    return resolved


def resolve_target(workspace: Path, target_str: str) -> Path:
    raw = Path(target_str).expanduser()
    target = raw if raw.is_absolute() else workspace / raw
    target = target.resolve()
    if not target.exists():
        raise ApsixError("pre", f"Target does not exist: {target}")
    try:
        target.relative_to(workspace)
    except ValueError as exc:
        raise ApsixError(
            "pre",
            f"Target must be inside workspace: target={target} workspace={workspace}",
        ) from exc
    return target


def run_cmd(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    check: bool = True,
    capture_output: bool = True,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=capture_output,
    )
    if check and result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        hint = stderr or stdout or f"exit={result.returncode}"
        raise ApsixError("runtime", f"Command failed: {' '.join(cmd)} :: {hint}")
    return result


def git(
    repo_root: Path,
    args: list[str],
    *,
    cwd: Path | None = None,
    check: bool = True,
    capture_output: bool = True,
) -> subprocess.CompletedProcess[str]:
    return run_cmd(["git", *args], cwd=cwd or repo_root, check=check, capture_output=capture_output)


def ensure_tools(repo_root: Path) -> None:
    for tool in ("git", "codex"):
        proc = run_cmd(
            ["/usr/bin/env", "bash", "-lc", f"command -v {tool}"],
            cwd=repo_root,
            check=False,
        )
        if proc.returncode != 0:
            raise ApsixError("pre", f"{tool} not found")
    git(repo_root, ["rev-parse", "--is-inside-work-tree"])


@contextlib.contextmanager
def repo_lock(repo_root: Path) -> Any:
    lock_path = repo_root / REPO_LOCK_NAME
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def process_alive(pid: int | None) -> bool:
    if pid is None or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True
