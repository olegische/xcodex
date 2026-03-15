from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from .common import ApsixError, now_iso, sha1_text, stream_line
from .repo_ops import git, repo_lock
from .storage import anchor_id, emit_anchor, emit_decision, emit_event, event_record, membrane_decision_record, request_id
from .zone_state import zone_sections_root_rel


def parse_status_paths(status_output: str) -> list[str]:
    paths: list[str] = []
    for raw_line in status_output.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue
        payload = line[3:] if len(line) > 3 else ""
        if " -> " in payload:
            payload = payload.split(" -> ", 1)[1]
        paths.append(payload.strip())
    return paths


def assert_no_conflict_markers(path: Path) -> None:
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if line.startswith("<<<<<<<") or line.startswith("=======") or line.startswith(">>>>>>>"):
            raise ApsixError("anchor", f"Conflict marker found in {path}:{line_no}")


def cleanup_actor_log(path: Path) -> None:
    if path.exists():
        path.unlink()


def prepare_task_runtime(zone: dict[str, Any], task: dict[str, Any]) -> dict[str, str]:
    repo_root = Path(zone["domain_spec"]["repo_root"])
    worktree_abs = repo_root / task["worktree_rel"]
    with repo_lock(repo_root):
        git(repo_root, ["worktree", "prune"], check=False)
        branch_exists = (
            git(
                repo_root,
                ["show-ref", "--quiet", f"refs/heads/{task['branch']}"],
                check=False,
                capture_output=False,
            ).returncode
            == 0
        )
        if not branch_exists:
            git(repo_root, ["branch", task["branch"]])
        if not worktree_abs.is_dir():
            add = git(repo_root, ["worktree", "add", task["worktree_rel"], task["branch"]], check=False)
            if add.returncode != 0:
                stderr = (add.stderr or "") + "\n" + (add.stdout or "")
                if "already registered worktree" in stderr:
                    git(repo_root, ["worktree", "prune"], check=False)
                    git(repo_root, ["worktree", "add", "-f", task["worktree_rel"], task["branch"]])
                else:
                    raise ApsixError("spawn", f"git worktree add failed: {(add.stderr or add.stdout or '').strip()}")
    (worktree_abs / task["candidate_dir"]).mkdir(parents=True, exist_ok=True)
    return {"worktree_abs": str(worktree_abs), "worktree_rel": task["worktree_rel"]}


def build_markdown_prompt(zone: dict[str, Any], task: dict[str, Any]) -> str:
    target_rel = zone["domain_spec"]["target_rel"]
    sections_root_rel = zone_sections_root_rel(zone)
    return (
        "You are running inside an APSIX actor workspace.\n\n"
        f"Zone ID: {zone['zone_id']}\n"
        f"Target draft: {target_rel}\n"
        f"Partition: {task['section_title']}\n"
        f"Authoritative output boundary: {sections_root_rel}\n"
        f"Candidate output file: {task['candidate_path']}\n\n"
        "APSIX runtime rules:\n"
        "- Read the full draft before rewriting the target partition.\n"
        "- Work only on the admitted partition.\n"
        "- Do not modify other sections.\n"
        "- Do not write under any other sections root.\n"
        "- Do not invent citations.\n"
        "- If you use web research, include direct URLs in the section when appropriate.\n"
        "- Markdown only.\n\n"
        "Tasks:\n"
        f"1. Read the full draft at {target_rel}.\n"
        f"2. Locate the section titled \"{task['section_title']}\".\n"
        "3. Understand its role in the full argument.\n"
        "4. Research relevant peer-reviewed literature.\n"
        "5. Rewrite only that section as a strong scientific section.\n\n"
        f"Write the result exactly to {task['candidate_path']}.\n"
    )


def run_task_actor(
    zone: dict[str, Any],
    task: dict[str, Any],
    *,
    on_started: Any | None = None,
) -> dict[str, Any]:
    started = now_iso()
    repo_root = Path(zone["domain_spec"]["repo_root"])
    profile = zone["selection"]["profile"]
    current_run_id = task.get("active_run_id", "")
    current_request_id = task.get("active_request_id", "")
    try:
        runtime_ctx = prepare_task_runtime(zone, task)
        worktree_abs = Path(runtime_ctx["worktree_abs"])
        log_name = f"codex_{task['section_slug']}.log"
        log_path = worktree_abs / log_name
        prompt = build_markdown_prompt(zone, task)
        cmd = ["codex", "exec", "--profile", profile, "--cd", ".", "--skip-git-repo-check", "--json"]
        with log_path.open("w", encoding="utf-8") as handle:
            proc = subprocess.Popen(
                cmd,
                cwd=str(worktree_abs),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            if on_started is not None:
                on_started(
                    {
                        "task_id": task["task_id"],
                        "request_id": current_request_id,
                        "run_id": current_run_id,
                        "pid": proc.pid,
                        "log_path": f"{task['worktree_rel']}/{log_name}",
                        "started_at": started,
                    }
                )
            assert proc.stdin is not None
            assert proc.stdout is not None
            proc.stdin.write(prompt)
            proc.stdin.close()
            for line in proc.stdout:
                stream_line(task["section_slug"], line)
                handle.write(line)
            rc = proc.wait()
        if rc != 0:
            return {
                "task_id": task["task_id"],
                "request_id": current_request_id,
                "run_id": current_run_id,
                "status": "failed",
                "exit_code": rc,
                "started_at": started,
                "ended_at": now_iso(),
                "log_path": f"{task['worktree_rel']}/{log_name}",
                "pid": proc.pid,
                "error": f"codex exec failed with exit code {rc}",
            }
        candidate_abs = worktree_abs / task["candidate_path"]
        if not candidate_abs.is_file():
            raise ApsixError("anchor", f"Candidate output missing: {task['candidate_path']}")
        if candidate_abs.stat().st_size == 0:
            raise ApsixError("anchor", f"Candidate output empty: {task['candidate_path']}")
        assert_no_conflict_markers(candidate_abs)
        cleanup_actor_log(log_path)
        status = git(repo_root, ["status", "--porcelain", "--untracked-files=all"], cwd=worktree_abs).stdout
        changed_paths = parse_status_paths(status)
        allowed_dir = task["candidate_dir"].rstrip("/")
        allowed_file = task["candidate_path"].rstrip("/")
        allowed_prefix = f"{allowed_dir}/"
        disallowed = [
            path
            for path in changed_paths
            if path and not (path == allowed_dir or path == allowed_file or path.startswith(allowed_prefix))
        ]
        if disallowed:
            raise ApsixError("anchor", "Disallowed changes outside partition output: " + ", ".join(disallowed))
        git(repo_root, ["add", "-A", task["candidate_dir"]], cwd=worktree_abs)
        if git(repo_root, ["diff", "--cached", "--quiet"], cwd=worktree_abs, check=False, capture_output=False).returncode == 0:
            return {
                "task_id": task["task_id"],
                "request_id": current_request_id,
                "run_id": current_run_id,
                "status": "noop",
                "exit_code": 0,
                "started_at": started,
                "ended_at": now_iso(),
                "log_path": "",
                "pid": proc.pid,
                "commit": git(repo_root, ["rev-parse", "HEAD"], cwd=worktree_abs).stdout.strip(),
            }
        git(repo_root, ["commit", "-m", f"apsix({task['section_slug']}): anchor candidate"], cwd=worktree_abs)
        return {
            "task_id": task["task_id"],
            "request_id": current_request_id,
            "run_id": current_run_id,
            "status": "success",
            "exit_code": 0,
            "started_at": started,
            "ended_at": now_iso(),
            "log_path": "",
            "pid": proc.pid,
            "commit": git(repo_root, ["rev-parse", "HEAD"], cwd=worktree_abs).stdout.strip(),
        }
    except ApsixError as exc:
        return {
            "task_id": task["task_id"],
            "request_id": current_request_id,
            "run_id": current_run_id,
            "status": "failed",
            "exit_code": 1,
            "started_at": started,
            "ended_at": now_iso(),
            "log_path": "",
            "pid": None,
            "error": f"{exc.phase}: {exc}",
        }


def anchor_artifact(
    zone: dict[str, Any],
    task: dict[str, Any],
    paths: dict[str, Path],
    *,
    artifact_type: str,
    artifact_path: str,
    commit_sha: str,
    branch: str,
    request_id_value: str = "",
    run_id_value: str = "",
) -> str:
    if zone["budget_state"]["anchor_used"] >= zone["budget_state"]["anchor_budget"]:
        raise ApsixError("anchor", f"Anchor budget exhausted for zone {zone['zone_id']}")
    artifact_id = sha1_text(f"{zone['zone_id']}:{task['task_id']}:{artifact_type}:{artifact_path}")[:12]
    anchor_request_id = request_id_value or request_id(zone["zone_id"], "anchor", f"{task['task_id']}:{artifact_type}")
    decision = membrane_decision_record(
        zone,
        request_type="anchor",
        subject_ref=f"{task['task_id']}:{artifact_type}",
        decision="allow",
        reason_code="artifact_validated",
        capability_basis={"capabilities": ["anchor"], "partition_id": task["partition_id"]},
        budget_context=zone["budget_state"],
        request_id_value=anchor_request_id,
    )
    emit_decision(zone, paths, decision)
    emit_anchor(
        zone,
        paths,
        {
            "anchor_id": anchor_id(zone["zone_id"], artifact_id),
            "artifact_id": artifact_id,
            "zone_id": zone["zone_id"],
            "policy_version": zone["membrane_policy_version"],
            "decision": "allow",
            "timestamp_or_order": now_iso(),
            "path": artifact_path,
            "artifact_type": artifact_type,
            "task_id": task["task_id"],
            "branch": branch,
            "commit": commit_sha,
            "request_id": anchor_request_id,
            "run_id": run_id_value,
        },
    )
    emit_event(
        zone,
        paths,
        event_record(
            zone,
            event_type="anchor_decision",
            subject_ref=f"{task['task_id']}:{artifact_type}",
            request_id_value=anchor_request_id,
            run_id_value=run_id_value,
            payload={
                "artifact_id": artifact_id,
                "path": artifact_path,
                "decision_id": decision["decision_id"],
                "commit": commit_sha,
                "branch": branch,
            },
        ),
    )
    zone["artifacts"][artifact_id] = {
        "artifact_id": artifact_id,
        "origin_actor_id": f"actor:{task['task_id']}",
        "zone_id": zone["zone_id"],
        "artifact_type": artifact_type,
        "status": "anchored",
        "path": artifact_path,
        "provenance": {
            "task_id": task["task_id"],
            "section_title": task["section_title"],
            "section_slug": task["section_slug"],
            "partition_id": task["partition_id"],
            "branch": branch,
            "commit": commit_sha,
            "membrane_decision_id": decision["decision_id"],
            "request_id": anchor_request_id,
            "run_id": run_id_value,
        },
    }
    zone["budget_state"]["anchor_used"] += 1
    return artifact_id


def candidate_anchor_present(zone: dict[str, Any], task: dict[str, Any], artifact_already_anchored: Any) -> bool:
    return artifact_already_anchored(zone, task["task_id"], "section_candidate", task["candidate_path"])
