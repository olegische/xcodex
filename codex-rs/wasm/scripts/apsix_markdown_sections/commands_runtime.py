from __future__ import annotations

import concurrent.futures
import json
import shutil
import threading
from concurrent.futures import CancelledError
from pathlib import Path

from .actor_runtime import anchor_artifact, assert_no_conflict_markers, candidate_anchor_present, run_task_actor
from .common import ApsixError, log, now_iso
from .reconcile_ops import artifact_already_anchored, cleanup_zone_runtime, reconcile_zone
from .repo_ops import detect_git_root, ensure_tools, git
from .reporting import zone_report, zone_report_json
from .storage import emit_decision, emit_event, event_record, membrane_decision_record, request_id, run_id
from .zone_state import (
    budget_context_snapshot,
    load_zone,
    ordered_task_ids,
    persist_zone,
    recompute_spawn_used,
    resolve_final_output_rel,
    resolve_task_ids,
    sync_task_partition_state,
    zone_sections_root_rel,
)


def cmd_spawn(args) -> int:
    repo_root = detect_git_root(Path.cwd())
    ensure_tools(repo_root)
    zone, paths = load_zone(repo_root, args.zone_id)
    if zone["lifecycle_state"] in {"quarantined", "frozen", "closed"}:
        raise ApsixError("spawn", f"Zone is not open for spawn: {zone['lifecycle_state']}")
    selected_task_ids = resolve_task_ids(zone, list(args.partition or [])) if args.partition else ordered_task_ids(zone)
    runnable: list[str] = []
    denied = 0
    deferred = 0
    projected_spawn_pressure = zone["budget_state"]["spawn_pressure_used"]
    for task_id in selected_task_ids:
        task = zone["tasks"][task_id]
        spawn_request_id = request_id(zone["zone_id"], "spawn", task_id)
        decision = "allow"
        reason_code = "spawn_allowed"
        if projected_spawn_pressure >= zone["budget_state"]["spawn_budget"]:
            decision = "deny"
            reason_code = "spawn_budget_exhausted"
        elif not args.include_unadmitted and not task["admitted"]:
            decision = "deny"
            reason_code = "not_admitted"
        elif task["status"] in {"success", "noop", "harvested"}:
            decision = "deny"
            reason_code = "already_completed"
        record = membrane_decision_record(
            zone,
            request_type="spawn",
            subject_ref=task_id,
            decision=decision,
            reason_code=reason_code,
            capability_basis={"capabilities": ["transform", "anchor"], "partition_id": task["partition_id"]},
            budget_context=budget_context_snapshot(zone, spawn_pressure_used=projected_spawn_pressure),
            request_id_value=spawn_request_id,
        )
        emit_decision(zone, paths, record)
        emit_event(
            zone,
            paths,
            event_record(
                zone,
                event_type="actor_admission_decision",
                subject_ref=task_id,
                request_id_value=spawn_request_id,
                payload={"decision_id": record["decision_id"], "decision": decision, "reason_code": reason_code},
            ),
        )
        if decision == "allow":
            task["status"] = "admitted"
            task["active_request_id"] = spawn_request_id
            task["active_run_id"] = run_id(zone["zone_id"], task_id)
            sync_task_partition_state(zone, task_id, status="admitted")
            runnable.append(task_id)
            projected_spawn_pressure += 1
            continue
        denied += 1
        if reason_code == "spawn_budget_exhausted":
            deferred += 1
            task["status"] = "admitted" if task["admitted"] else "instantiated"
            sync_task_partition_state(zone, task_id, status=task["status"])
            emit_event(
                zone,
                paths,
                event_record(
                    zone,
                    event_type="spawn_deferred",
                    subject_ref=task_id,
                    request_id_value=spawn_request_id,
                    payload={"reason_code": reason_code},
                ),
            )
        elif reason_code == "not_admitted":
            task["status"] = "instantiated"
            sync_task_partition_state(zone, task_id, status="instantiated")
        elif reason_code == "already_completed":
            sync_task_partition_state(zone, task_id, status=task["status"])
        else:
            task["status"] = "failed"
            task["last_run"] = {"started_at": now_iso(), "ended_at": now_iso(), "exit_code": 1, "log_path": "", "error": reason_code}
            task["active_request_id"] = spawn_request_id
            task["active_run_id"] = ""
            sync_task_partition_state(zone, task_id, status="failed")
    recompute_spawn_used(zone)
    persist_zone(zone, paths)
    if not runnable:
        raise ApsixError("spawn", "No tasks admitted by membrane for spawn")
    failures = 0
    stop_requested = False
    state_lock = threading.Lock()

    def on_actor_started(payload: dict[str, str]) -> None:
        task_id = payload["task_id"]
        with state_lock:
            task = zone["tasks"][task_id]
            task["status"] = "running"
            task["last_run"] = {
                "started_at": payload["started_at"],
                "ended_at": "",
                "exit_code": None,
                "log_path": payload["log_path"],
                "pid": payload["pid"],
            }
            sync_task_partition_state(zone, task_id, status="running")
            zone["actors"][f"actor:{task_id}"] = {
                "actor_id": f"actor:{task_id}",
                "zone_id": zone["zone_id"],
                "admitted_partitions": [task["partition_id"]],
                "capability_mask": ["transform", "anchor"],
                "budget_share": 1,
                "intent": f"transform:{task['section_slug']}",
                "status": "running",
                "pid": payload["pid"],
                "log_path": payload["log_path"],
                "started_at": payload["started_at"],
                "request_id": payload["request_id"],
                "run_id": payload["run_id"],
            }
            emit_event(
                zone,
                paths,
                event_record(
                    zone,
                    event_type="actor_started",
                    subject_ref=task_id,
                    request_id_value=payload["request_id"],
                    run_id_value=payload["run_id"],
                    payload={"pid": payload["pid"], "log_path": payload["log_path"]},
                ),
            )
            recompute_spawn_used(zone)
            persist_zone(zone, paths)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.max_parallel)) as executor:
        future_map = {executor.submit(run_task_actor, zone, zone["tasks"][task_id], on_started=on_actor_started): task_id for task_id in runnable}
        for future in concurrent.futures.as_completed(future_map):
            task_id = future_map[future]
            try:
                result = future.result()
            except CancelledError:
                with state_lock:
                    task = zone["tasks"][task_id]
                    task["status"] = "admitted" if task["admitted"] else "instantiated"
                    task["active_run_id"] = ""
                    task["active_request_id"] = ""
                    task["last_run"] = {"started_at": now_iso(), "ended_at": now_iso(), "exit_code": None, "log_path": "", "pid": None, "error": "spawn_cancelled_before_start"}
                    sync_task_partition_state(zone, task_id, status=task["status"])
                    emit_event(
                        zone,
                        paths,
                        event_record(
                            zone,
                            event_type="reconcile_requeued",
                            subject_ref=task_id,
                            request_id_value=request_id(zone["zone_id"], "spawn", task_id),
                            payload={"reason": "spawn_cancelled_before_start"},
                        ),
                    )
                    recompute_spawn_used(zone)
                    persist_zone(zone, paths)
                continue
            with state_lock:
                task = zone["tasks"][task_id]
                task["status"] = result["status"]
                task["last_run"] = {
                    "started_at": result["started_at"],
                    "ended_at": result["ended_at"],
                    "exit_code": result["exit_code"],
                    "log_path": result.get("log_path", ""),
                    "pid": result.get("pid"),
                }
                if result.get("error"):
                    task["last_run"]["error"] = result["error"]
                sync_task_partition_state(zone, task_id, status=task["status"])
                zone["actors"][f"actor:{task_id}"] = {
                    "actor_id": f"actor:{task_id}",
                    "zone_id": zone["zone_id"],
                    "admitted_partitions": [task["partition_id"]],
                    "capability_mask": ["transform", "anchor"],
                    "budget_share": 1,
                    "intent": f"transform:{task['section_slug']}",
                    "status": task["status"],
                    "pid": result.get("pid"),
                    "log_path": result.get("log_path", ""),
                    "started_at": result["started_at"],
                    "ended_at": result["ended_at"],
                    "request_id": result.get("request_id", ""),
                    "run_id": result.get("run_id", ""),
                }
                emit_event(
                    zone,
                    paths,
                    event_record(
                        zone,
                        event_type="transform_completion" if task["status"] in {"success", "noop"} else "transform_failure",
                        subject_ref=task_id,
                        request_id_value=result.get("request_id", ""),
                        run_id_value=result.get("run_id", ""),
                        payload={"exit_code": result["exit_code"], "log_path": result.get("log_path", ""), "pid": result.get("pid"), "error": result.get("error", "")},
                    ),
                )
                if task["status"] in {"success", "noop"}:
                    task["commit"] = result.get("commit", "") or task["commit"]
                    artifact_id = anchor_artifact(
                        zone,
                        task,
                        paths,
                        artifact_type="section_candidate",
                        artifact_path=task["candidate_path"],
                        commit_sha=task["commit"],
                        branch=task["branch"],
                        request_id_value=result.get("request_id", ""),
                        run_id_value=result.get("run_id", ""),
                    )
                    zone["runs"].append(
                        {
                            "run_id": result.get("run_id", ""),
                            "request_id": result.get("request_id", ""),
                            "run_kind": "execution_run",
                            "task_id": task_id,
                            "status": task["status"],
                            "anchored_artifacts": [artifact_id],
                            "started_at": result["started_at"],
                            "ended_at": result["ended_at"],
                        }
                    )
                else:
                    failures += 1
                    zone["runs"].append(
                        {
                            "run_id": result.get("run_id", ""),
                            "request_id": result.get("request_id", ""),
                            "run_kind": "execution_run",
                            "task_id": task_id,
                            "status": task["status"],
                            "error": result.get("error", ""),
                            "started_at": result["started_at"],
                            "ended_at": result["ended_at"],
                        }
                    )
                zone["run_counters"]["execution_runs_total"] += 1
                task["active_run_id"] = ""
                recompute_spawn_used(zone)
                persist_zone(zone, paths)
            if task["status"] not in {"success", "noop"} and not args.continue_on_error and not stop_requested:
                stop_requested = True
                for pending in future_map:
                    if pending is not future and not pending.done():
                        pending.cancel()
    hard_denied = denied - deferred
    log(f"spawn zone={zone['zone_id']} executed={len(runnable)} failures={failures + hard_denied} deferred={deferred}")
    return 1 if (failures + hard_denied) else 0


def cmd_harvest(args) -> int:
    repo_root = detect_git_root(Path.cwd())
    ensure_tools(repo_root)
    zone, paths = load_zone(repo_root, args.zone_id)
    if git(repo_root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip() != "main":
        raise ApsixError("harvest", "Harvest must be run from main branch")
    if git(repo_root, ["status", "--porcelain"]).stdout.strip():
        raise ApsixError("harvest", "Working tree not clean; commit or stash changes first")
    running = [task_id for task_id in ordered_task_ids(zone) if zone["tasks"][task_id]["status"] == "running"]
    if running:
        raise ApsixError("harvest", "Harvest blocked: some tasks are still running")
    task_ids = resolve_task_ids(zone, list(args.partition or [])) if args.partition else ordered_task_ids(zone)
    harvested = 0
    outputs_root_rel = zone_sections_root_rel(zone)
    for task_id in task_ids:
        task = zone["tasks"][task_id]
        if task["status"] not in {"success", "noop"}:
            continue
        final_rel = resolve_final_output_rel(zone, task)
        worktree_abs = repo_root / task["worktree_rel"]
        if git(repo_root, ["show-ref", "--quiet", f"refs/heads/{task['branch']}"], check=False, capture_output=False).returncode != 0:
            raise ApsixError("harvest", f"Candidate branch missing for task {task_id}: {task['branch']}")
        if not worktree_abs.is_dir():
            git(repo_root, ["worktree", "add", task["worktree_rel"], task["branch"]])
        src_abs = worktree_abs / task["candidate_path"]
        dst_abs = worktree_abs / final_rel
        if not candidate_anchor_present(zone, task, artifact_already_anchored):
            raise ApsixError("harvest", f"Candidate artifact not anchored for task {task_id}: {task['candidate_path']}")
        if not src_abs.is_file():
            raise ApsixError("harvest", f"Anchored candidate missing for task {task_id}: {task['candidate_path']}")
        if src_abs.stat().st_size == 0:
            raise ApsixError("harvest", f"Anchored candidate empty for task {task_id}: {task['candidate_path']}")
        assert_no_conflict_markers(src_abs)
        harvest_request_id = request_id(zone["zone_id"], "harvest", task_id)
        harvest_run_id = run_id(zone["zone_id"], task_id)
        decision = membrane_decision_record(
            zone,
            request_type="harvest",
            subject_ref=task_id,
            decision="allow",
            reason_code="anchored_candidate_available",
            capability_basis={"capabilities": ["harvest"], "partition_id": task["partition_id"]},
            budget_context=zone["budget_state"],
            request_id_value=harvest_request_id,
        )
        emit_decision(zone, paths, decision)
        emit_event(
            zone,
            paths,
            event_record(
                zone,
                event_type="harvest_decision",
                subject_ref=task_id,
                request_id_value=harvest_request_id,
                run_id_value=harvest_run_id,
                payload={"decision_id": decision["decision_id"]},
            ),
        )
        dst_abs.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src_abs, dst_abs)
        src_abs.unlink()
        prune = src_abs.parent
        while prune != worktree_abs and prune.exists():
            try:
                prune.rmdir()
            except OSError:
                break
            prune = prune.parent
        if git(repo_root, ["status", "--porcelain"], cwd=worktree_abs).stdout.strip():
            git(repo_root, ["add", "-A"], cwd=worktree_abs)
            git(repo_root, ["commit", "-m", f"apsix({task['section_slug']}): harvest final artifact"], cwd=worktree_abs)
        task["finalize_commit"] = git(repo_root, ["rev-parse", "HEAD"], cwd=worktree_abs).stdout.strip()
        task["final_path"] = final_rel
        git(repo_root, ["merge", "--no-edit", task["branch"]])
        artifact_id = anchor_artifact(
            zone,
            task,
            paths,
            artifact_type="section_final",
            artifact_path=task["final_path"],
            commit_sha=task["finalize_commit"],
            branch="main",
            request_id_value=harvest_request_id,
            run_id_value=harvest_run_id,
        )
        task["status"] = "harvested"
        sync_task_partition_state(zone, task_id, status="harvested")
        zone["runs"].append(
            {
                "run_id": harvest_run_id,
                "request_id": harvest_request_id,
                "run_kind": "harvest_run",
                "task_id": task_id,
                "status": "harvested",
                "anchored_artifacts": [artifact_id],
                "started_at": now_iso(),
                "ended_at": now_iso(),
            }
        )
        zone["run_counters"]["harvest_runs_total"] += 1
        recompute_spawn_used(zone)
        harvested += 1
        persist_zone(zone, paths)
    log(f"harvest zone={zone['zone_id']} harvested={harvested} outputs_root={outputs_root_rel}")
    return 0


def cmd_freeze(args) -> int:
    repo_root = detect_git_root(Path.cwd())
    zone, paths = load_zone(repo_root, args.zone_id)
    if any(zone["tasks"][task_id]["status"] == "running" for task_id in ordered_task_ids(zone)):
        raise ApsixError("freeze", "Cannot freeze while tasks are running")
    cleanup_summary = cleanup_zone_runtime(repo_root, zone)
    freeze_request_id = request_id(zone["zone_id"], "freeze", zone["zone_id"])
    decision = membrane_decision_record(
        zone,
        request_type="freeze",
        subject_ref=zone["zone_id"],
        decision="allow",
        reason_code="operator_freeze",
        capability_basis={"capabilities": ["freeze"], "partition_id": "zone"},
        budget_context=zone["budget_state"],
        request_id_value=freeze_request_id,
    )
    emit_decision(zone, paths, decision)
    zone["lifecycle_state"] = "frozen"
    zone["cleanup_summary"] = cleanup_summary
    emit_event(
        zone,
        paths,
        event_record(
            zone,
            event_type="freeze",
            subject_ref=zone["zone_id"],
            request_id_value=freeze_request_id,
            payload={"decision_id": decision["decision_id"], **cleanup_summary},
        ),
    )
    persist_zone(zone, paths)
    log(f"frozen zone={zone['zone_id']} removed_worktrees={cleanup_summary['removed_worktrees']} deleted_branches={cleanup_summary['deleted_branches']}")
    return 0


def cmd_reconcile(args) -> int:
    repo_root = detect_git_root(Path.cwd())
    zone, paths = load_zone(repo_root, args.zone_id)
    summary = reconcile_zone(repo_root, zone, paths)
    log(
        "reconcile zone={} kept_running={} requeued={} recovered_success={} marked_failed={} failed_normalized={}".format(
            zone["zone_id"],
            summary["running_kept"],
            summary["requeued"],
            summary["recovered_success"],
            summary["marked_failed"],
            summary["failed_normalized"],
        )
    )
    return 0


def cmd_report(args) -> int:
    repo_root = detect_git_root(Path.cwd())
    zone, paths = load_zone(repo_root, args.zone_id)
    if args.json:
        print(json.dumps(zone_report_json(repo_root, zone, paths), ensure_ascii=True, indent=2, sort_keys=True))
    else:
        for line in zone_report(repo_root, zone, paths):
            print(line)
    return 0
