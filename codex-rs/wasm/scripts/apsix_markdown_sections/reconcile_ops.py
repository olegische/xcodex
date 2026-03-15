from __future__ import annotations

from pathlib import Path
from typing import Any

from .actor_runtime import anchor_artifact, assert_no_conflict_markers, cleanup_actor_log, parse_status_paths
from .common import now_iso
from .repo_ops import branch_exists, branch_head_contains_path, git, process_alive, repo_lock, worktree_exists
from .storage import emit_event, event_record, request_id, run_id
from .zone_state import ordered_task_ids, recompute_spawn_used, persist_zone, sync_task_partition_state


def artifact_already_anchored(zone: dict[str, Any], task_id: str, artifact_type: str, artifact_path: str) -> bool:
    for artifact in zone.get("artifacts", {}).values():
        if (
            artifact.get("artifact_type") == artifact_type
            and artifact.get("path") == artifact_path
            and artifact.get("provenance", {}).get("task_id") == task_id
        ):
            return True
    return False


def task_has_execution_witness(zone: dict[str, Any], task_id: str) -> bool:
    task = zone["tasks"][task_id]
    actor = zone.get("actors", {}).get(f"actor:{task_id}", {})
    last_run = task.get("last_run") or {}
    if actor.get("started_at") or last_run.get("started_at"):
        return True
    return actor.get("pid") not in (None, "", 0)


def recover_candidate_from_worktree(
    repo_root: Path,
    zone: dict[str, Any],
    task: dict[str, Any],
    paths: dict[str, Path],
) -> bool:
    if not task_has_execution_witness(zone, task["task_id"]):
        return False
    worktree_abs = repo_root / task["worktree_rel"]
    candidate_abs = worktree_abs / task["candidate_path"]
    recovery_request_id = request_id(zone["zone_id"], "reconcile", task["task_id"])
    recovery_run_id = run_id(zone["zone_id"], task["task_id"])
    cleanup_actor_log(worktree_abs / f"codex_{task['section_slug']}.log")
    if not candidate_abs.is_file() or candidate_abs.stat().st_size == 0:
        return False
    assert_no_conflict_markers(candidate_abs)
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
        return False
    git(repo_root, ["add", "-A", task["candidate_dir"]], cwd=worktree_abs)
    if git(repo_root, ["diff", "--cached", "--quiet"], cwd=worktree_abs, check=False, capture_output=False).returncode != 0:
        git(repo_root, ["commit", "-m", f"apsix({task['section_slug']}): recover candidate"], cwd=worktree_abs)
    commit_sha = git(repo_root, ["rev-parse", "HEAD"], cwd=worktree_abs).stdout.strip()
    task["commit"] = commit_sha
    task["status"] = "success"
    task["active_run_id"] = ""
    task["last_run"] = {
        "started_at": now_iso(),
        "ended_at": now_iso(),
        "exit_code": 0,
        "log_path": "",
        "pid": None,
        "error": "recovered_existing_candidate",
    }
    sync_task_partition_state(zone, task["task_id"], status="success")
    zone["actors"][f"actor:{task['task_id']}"] = {
        "actor_id": f"actor:{task['task_id']}",
        "zone_id": zone["zone_id"],
        "admitted_partitions": [task["partition_id"]],
        "capability_mask": ["transform", "anchor"],
        "budget_share": 1,
        "intent": f"transform:{task['section_slug']}",
        "status": "success",
        "pid": None,
        "log_path": "",
        "started_at": task["last_run"]["started_at"],
        "ended_at": task["last_run"]["ended_at"],
        "request_id": recovery_request_id,
        "run_id": recovery_run_id,
    }
    anchored_ids: list[str] = []
    if not artifact_already_anchored(zone, task["task_id"], "section_candidate", task["candidate_path"]):
        anchored_ids.append(
            anchor_artifact(
                zone,
                task,
                paths,
                artifact_type="section_candidate",
                artifact_path=task["candidate_path"],
                commit_sha=commit_sha,
                branch=task["branch"],
                request_id_value=recovery_request_id,
                run_id_value=recovery_run_id,
            )
        )
    zone["runs"].append(
        {
            "run_id": recovery_run_id,
            "request_id": recovery_request_id,
            "run_kind": "recovery_run",
            "task_id": task["task_id"],
            "status": "success",
            "anchored_artifacts": anchored_ids,
            "started_at": task["last_run"]["started_at"],
            "ended_at": task["last_run"]["ended_at"],
            "recovered": True,
            "recovery_mode": "existing_candidate",
        }
    )
    zone["run_counters"]["recovery_runs_total"] += 1
    emit_event(
        zone,
        paths,
        event_record(
            zone,
            event_type="reconcile_recovered_success",
            subject_ref=task["task_id"],
            request_id_value=recovery_request_id,
            run_id_value=recovery_run_id,
            payload={"commit": commit_sha, "candidate_path": task["candidate_path"], "recovery_mode": "existing_candidate"},
        ),
    )
    return True


def reconcile_zone(repo_root: Path, zone: dict[str, Any], paths: dict[str, Path]) -> dict[str, int]:
    summary = {
        "running_kept": 0,
        "requeued": 0,
        "recovered_success": 0,
        "marked_failed": 0,
        "failed_normalized": 0,
        "cancelled_reservations_cleared": 0,
    }
    for task_id in ordered_task_ids(zone):
        task = zone["tasks"][task_id]
        if task["status"] != "running":
            continue
        actor_id = f"actor:{task_id}"
        actor = zone.get("actors", {}).get(actor_id, {})
        pid = actor.get("pid")
        if process_alive(pid):
            recompute_spawn_used(zone)
            summary["running_kept"] += 1
            continue
        if pid in (None, "", 0):
            requeue_request_id = request_id(zone["zone_id"], "reconcile", task_id)
            task["status"] = "admitted"
            task["active_run_id"] = ""
            sync_task_partition_state(zone, task_id, status="admitted")
            if task.get("last_run"):
                task["last_run"]["ended_at"] = now_iso()
                task["last_run"]["exit_code"] = None
                task["last_run"]["error"] = "reconciled_to_admitted_no_actor_started"
            if actor_id in zone.get("actors", {}):
                zone["actors"][actor_id]["status"] = "reconciled"
                zone["actors"][actor_id]["ended_at"] = now_iso()
            emit_event(
                zone,
                paths,
                event_record(
                    zone,
                    event_type="reconcile_requeued",
                    subject_ref=task_id,
                    request_id_value=requeue_request_id,
                    payload={"reason": "no_actor_started", "previous_pid": pid},
                ),
            )
            recompute_spawn_used(zone)
            summary["requeued"] += 1
            continue
        candidate_committed = branch_exists(repo_root, task["branch"]) and branch_head_contains_path(
            repo_root,
            task["branch"],
            task["candidate_path"],
        )
        if candidate_committed:
            recovery_request_id = request_id(zone["zone_id"], "reconcile", task_id)
            recovery_run_id = run_id(zone["zone_id"], task_id)
            commit_sha = git(repo_root, ["rev-parse", task["branch"]]).stdout.strip()
            task["commit"] = commit_sha
            task["status"] = "success"
            task["active_run_id"] = ""
            task["last_run"] = {
                "started_at": actor.get("started_at", now_iso()),
                "ended_at": now_iso(),
                "exit_code": 0,
                "log_path": actor.get("log_path", ""),
                "pid": pid,
                "error": "recovered_from_interrupted_runtime",
            }
            sync_task_partition_state(zone, task_id, status="success")
            zone["actors"][actor_id] = {
                "actor_id": actor_id,
                "zone_id": zone["zone_id"],
                "admitted_partitions": [task["partition_id"]],
                "capability_mask": ["transform", "anchor"],
                "budget_share": 1,
                "intent": f"transform:{task['section_slug']}",
                "status": "success",
                "pid": pid,
                "log_path": actor.get("log_path", ""),
                "started_at": actor.get("started_at", ""),
                "ended_at": now_iso(),
                "request_id": recovery_request_id,
                "run_id": recovery_run_id,
            }
            anchored_ids: list[str] = []
            if not artifact_already_anchored(zone, task_id, "section_candidate", task["candidate_path"]):
                anchored_ids.append(
                    anchor_artifact(
                        zone,
                        task,
                        paths,
                        artifact_type="section_candidate",
                        artifact_path=task["candidate_path"],
                        commit_sha=commit_sha,
                        branch=task["branch"],
                        request_id_value=recovery_request_id,
                        run_id_value=recovery_run_id,
                    )
                )
            zone["runs"].append(
                {
                    "run_id": recovery_run_id,
                    "request_id": recovery_request_id,
                    "run_kind": "recovery_run",
                    "task_id": task_id,
                    "status": "success",
                    "anchored_artifacts": anchored_ids,
                    "started_at": actor.get("started_at", ""),
                    "ended_at": now_iso(),
                    "recovered": True,
                }
            )
            zone["run_counters"]["recovery_runs_total"] += 1
            emit_event(
                zone,
                paths,
                event_record(
                    zone,
                    event_type="reconcile_recovered_success",
                    subject_ref=task_id,
                    request_id_value=recovery_request_id,
                    run_id_value=recovery_run_id,
                    payload={"pid": pid, "commit": commit_sha, "candidate_path": task["candidate_path"]},
                ),
            )
            recompute_spawn_used(zone)
            summary["recovered_success"] += 1
            continue
        task["status"] = "failed"
        task["active_run_id"] = ""
        task["last_run"] = {
            "started_at": actor.get("started_at", now_iso()),
            "ended_at": now_iso(),
            "exit_code": 1,
            "log_path": actor.get("log_path", ""),
            "pid": pid,
            "error": "interrupted_actor_process_missing",
        }
        sync_task_partition_state(zone, task_id, status="failed")
        zone["actors"][actor_id] = {
            "actor_id": actor_id,
            "zone_id": zone["zone_id"],
            "admitted_partitions": [task["partition_id"]],
            "capability_mask": ["transform", "anchor"],
            "budget_share": 1,
            "intent": f"transform:{task['section_slug']}",
            "status": "failed",
            "pid": pid,
            "log_path": actor.get("log_path", ""),
            "started_at": actor.get("started_at", ""),
            "ended_at": now_iso(),
        }
        emit_event(
            zone,
            paths,
            event_record(
                zone,
                event_type="reconcile_marked_failed",
                subject_ref=task_id,
                request_id_value=request_id(zone["zone_id"], "reconcile", task_id),
                payload={"pid": pid, "reason": "actor_process_missing"},
            ),
        )
        recompute_spawn_used(zone)
        summary["marked_failed"] += 1
    for task_id in ordered_task_ids(zone):
        task = zone["tasks"][task_id]
        if task["status"] in {"failed", "admitted"} and recover_candidate_from_worktree(repo_root, zone, task, paths):
            recompute_spawn_used(zone)
            summary["recovered_success"] += 1
    for task_id in ordered_task_ids(zone):
        task = zone["tasks"][task_id]
        if task["status"] != "failed":
            continue
        worktree_abs = repo_root / task["worktree_rel"]
        candidate_abs = worktree_abs / task["candidate_path"]
        if branch_exists(repo_root, task["branch"]) or worktree_abs.exists() or candidate_abs.exists():
            continue
        task["status"] = "admitted" if task["admitted"] else "instantiated"
        task["active_run_id"] = ""
        sync_task_partition_state(zone, task_id, status=task["status"])
        emit_event(
            zone,
            paths,
            event_record(
                zone,
                event_type="reconcile_failed_normalized",
                subject_ref=task_id,
                request_id_value=request_id(zone["zone_id"], "reconcile", task_id),
                payload={"reason": "no_runtime_footprint", "new_status": task["status"]},
            ),
        )
        summary["failed_normalized"] += 1
    for task_id in ordered_task_ids(zone):
        task = zone["tasks"][task_id]
        if task["status"] != "admitted" or not task.get("active_run_id") or task_has_execution_witness(zone, task_id):
            continue
        task["active_run_id"] = ""
        task["active_request_id"] = ""
        sync_task_partition_state(zone, task_id, status="admitted")
        emit_event(
            zone,
            paths,
            event_record(
                zone,
                event_type="reconcile_requeued",
                subject_ref=task_id,
                request_id_value=request_id(zone["zone_id"], "reconcile", task_id),
                payload={"reason": "reserved_no_actor_started"},
            ),
        )
        summary["cancelled_reservations_cleared"] += 1
    recompute_spawn_used(zone)
    persist_zone(zone, paths)
    return summary


def cleanup_zone_runtime(repo_root: Path, zone: dict[str, Any]) -> dict[str, int]:
    removed_worktrees = 0
    deleted_branches = 0
    missing_worktrees = 0
    missing_branches = 0
    worktree_errors = 0
    branch_errors = 0
    with repo_lock(repo_root):
        for task_id in ordered_task_ids(zone):
            task = zone["tasks"][task_id]
            worktree_rel = task["worktree_rel"]
            branch = task["branch"]
            if worktree_exists(repo_root, worktree_rel):
                if git(repo_root, ["worktree", "remove", "--force", worktree_rel], check=False).returncode == 0:
                    removed_worktrees += 1
                else:
                    worktree_errors += 1
            else:
                missing_worktrees += 1
            if branch_exists(repo_root, branch):
                if git(repo_root, ["branch", "-D", branch], check=False).returncode == 0:
                    deleted_branches += 1
                else:
                    branch_errors += 1
            else:
                missing_branches += 1
        git(repo_root, ["worktree", "prune"], check=False)
    return {
        "removed_worktrees": removed_worktrees,
        "deleted_branches": deleted_branches,
        "missing_worktrees": missing_worktrees,
        "missing_branches": missing_branches,
        "worktree_errors": worktree_errors,
        "branch_errors": branch_errors,
    }
