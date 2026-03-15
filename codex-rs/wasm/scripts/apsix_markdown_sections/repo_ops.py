from __future__ import annotations

from apsix_shared.repo_ops import detect_git_root, ensure_tools, git, process_alive, repo_lock, resolve_target, resolve_workspace, run_cmd


def branch_exists(repo_root: Path, branch: str) -> bool:
    return (
        git(
            repo_root,
            ["show-ref", "--quiet", f"refs/heads/{branch}"],
            check=False,
            capture_output=False,
        ).returncode
        == 0
    )


def branch_head_contains_path(repo_root: Path, branch: str, rel_path: str) -> bool:
    result = git(repo_root, ["ls-tree", "-r", "--name-only", branch, "--", rel_path], check=False)
    if result.returncode != 0:
        return False
    return any(line.strip() == rel_path for line in result.stdout.splitlines())


def worktree_exists(repo_root: Path, worktree_rel: str) -> bool:
    return (repo_root / worktree_rel).exists()
