#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys
import threading
from concurrent.futures import CancelledError
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from apsix_markdown_sections.actor_runtime import anchor_artifact, run_task_actor
from apsix_markdown_sections.cli import build_parser
from apsix_markdown_sections.commands_basic import cmd_admit as _cmd_admit
from apsix_markdown_sections.commands_basic import cmd_refine as _cmd_refine
from apsix_markdown_sections.commands_runtime import cmd_report as _cmd_report
from apsix_markdown_sections.common import ApsixError, log, now_iso
from apsix_markdown_sections.constants import DEFAULT_PROFILE, MARKDOWN_SECTIONS_KIND
from apsix_markdown_sections.repo_ops import detect_git_root, ensure_tools
from apsix_markdown_sections.storage import (
    emit_anchor,
    emit_decision,
    emit_event,
    event_record,
    load_jsonl,
    membrane_decision_record,
    run_id,
    zone_paths,
)
from apsix_markdown_sections.zone_state import (
    admit_tasks,
    budget_context_snapshot,
    build_zone,
    init_zone_logs,
    load_zone,
    ordered_task_ids,
    persist_zone,
    refine_markdown_sections,
    resolve_task_ids,
    sync_task_partition_state,
    zone_id_for,
)
from apsix_markdown_sections.reporting import event_timeline_metrics, zone_report_json


def cmd_zone(args: argparse.Namespace) -> int:
    from apsix_markdown_sections.commands_basic import cmd_zone as package_cmd_zone
    from apsix_markdown_sections import commands_basic as basic_mod

    original = basic_mod.ensure_tools
    basic_mod.ensure_tools = ensure_tools
    try:
        return package_cmd_zone(args)
    finally:
        basic_mod.ensure_tools = original


def cmd_refine(args: argparse.Namespace) -> int:
    return _cmd_refine(args)


def cmd_admit(args: argparse.Namespace) -> int:
    return _cmd_admit(args)


def cmd_spawn(args: argparse.Namespace) -> int:
    import concurrent.futures

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
        spawn_request_id = apsix_request_id(zone["zone_id"], "spawn", task_id)
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
                            request_id_value=apsix_request_id(zone["zone_id"], "spawn", task_id),
                            payload={"reason": "spawn_cancelled_before_start"},
                        ),
                    )
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
                persist_zone(zone, paths)

            if task["status"] not in {"success", "noop"} and not args.continue_on_error and not stop_requested:
                stop_requested = True
                for pending in future_map:
                    if pending is not future and not pending.done():
                        pending.cancel()

    hard_denied = denied - deferred
    log(f"spawn zone={zone['zone_id']} executed={len(runnable)} failures={failures + hard_denied} deferred={deferred}")
    return 1 if (failures + hard_denied) else 0


def cmd_report(args: argparse.Namespace) -> int:
    return _cmd_report(args)


def apsix_request_id(zone_id: str, request_type: str, subject_ref: str) -> str:
    from apsix_markdown_sections.storage import request_id

    return request_id(zone_id, request_type, subject_ref)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except ApsixError as exc:
        print(f"[ERROR] {exc.phase}: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
