from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from .common import duration_seconds, parse_scalar, parse_iso_or_none, summarize_durations
from .storage import load_jsonl
from .zone_state import ordered_task_ids, zone_sections_root_rel


def peak_running_from_events(records: list[dict[str, Any]]) -> int:
    running = 0
    peak = 0
    for record in records:
        event_type = record.get("event_type")
        if event_type == "actor_started":
            running += 1
            peak = max(peak, running)
        elif event_type in {
            "transform_completion",
            "transform_failure",
            "reconcile_recovered_success",
            "reconcile_marked_failed",
            "reconcile_requeued",
        }:
            running = max(0, running - 1)
    return peak


def earliest_event_time(records: list[dict[str, Any]], event_type: str) -> str:
    matches = [
        record.get("timestamp_or_order", "")
        for record in records
        if record.get("event_type") == event_type and record.get("timestamp_or_order")
    ]
    return min(matches) if matches else ""


def latest_event_time(records: list[dict[str, Any]], event_type: str) -> str:
    matches = [
        record.get("timestamp_or_order", "")
        for record in records
        if record.get("event_type") == event_type and record.get("timestamp_or_order")
    ]
    return max(matches) if matches else ""


def latest_event_time_any(records: list[dict[str, Any]], event_types: set[str]) -> str:
    matches = [
        record.get("timestamp_or_order", "")
        for record in records
        if record.get("event_type") in event_types and record.get("timestamp_or_order")
    ]
    return max(matches) if matches else ""


def event_timeline_metrics(events: list[dict[str, Any]], task_ids: list[str]) -> dict[str, Any]:
    logical_status = {task_id: "instantiated" for task_id in task_ids}
    admitted = {task_id: False for task_id in task_ids}
    running = 0
    pending_peak = 0
    pending_peak_at = ""
    time_to_first_success_at = ""
    terminal_statuses = {"success", "noop", "harvested"}
    for record in sorted(events, key=lambda item: item.get("timestamp_or_order", "")):
        event_type = record.get("event_type")
        task_id = record.get("subject_ref", "")
        payload = record.get("payload", {})
        timestamp = record.get("timestamp_or_order", "")
        if event_type == "task_admitted" and task_id in admitted:
            admitted[task_id] = True
        elif event_type == "actor_started" and task_id in logical_status:
            if logical_status[task_id] != "running":
                running += 1
            logical_status[task_id] = "running"
        elif event_type in {"transform_completion", "reconcile_recovered_success"} and task_id in logical_status:
            if logical_status[task_id] == "running":
                running = max(0, running - 1)
            logical_status[task_id] = "success"
            if not time_to_first_success_at:
                time_to_first_success_at = timestamp
        elif event_type in {"transform_failure", "reconcile_marked_failed"} and task_id in logical_status:
            if logical_status[task_id] == "running":
                running = max(0, running - 1)
            logical_status[task_id] = "failed"
        elif event_type == "reconcile_requeued" and task_id in logical_status:
            if logical_status[task_id] == "running":
                running = max(0, running - 1)
            logical_status[task_id] = "admitted" if admitted[task_id] else "instantiated"
        elif event_type == "reconcile_failed_normalized" and task_id in logical_status:
            logical_status[task_id] = payload.get("new_status", logical_status[task_id])
        pending_current = sum(
            1
            for current_task_id in task_ids
            if admitted[current_task_id]
            and logical_status[current_task_id] not in terminal_statuses
            and logical_status[current_task_id] != "running"
        )
        if pending_current > pending_peak:
            pending_peak = pending_current
            pending_peak_at = timestamp
    return {
        "pending_peak": pending_peak,
        "pending_peak_at": pending_peak_at,
        "time_to_first_success_at": time_to_first_success_at,
    }


def zone_report(repo_root: Path, zone: dict[str, Any], paths: dict[str, Path]) -> list[str]:
    decisions = load_jsonl(paths["decisions"])
    events = load_jsonl(paths["events"])
    anchors = load_jsonl(paths["anchors"])
    ledger_records = sorted([*events, *decisions, *anchors], key=lambda record: int(record.get("seq_no", 0)))
    tasks = zone.get("tasks", {})
    status_counts = Counter(task.get("status", "unknown") for task in tasks.values())
    artifact_counts = Counter(artifact.get("artifact_type", "unknown") for artifact in zone.get("artifacts", {}).values())
    decision_counts = Counter(
        f"{record.get('request_type')}:{record.get('decision')}:{record.get('reason_code')}" for record in decisions
    )
    decision_reason_counts = Counter(record.get("reason_code", "unknown") for record in decisions)
    execution_runs = [run for run in zone.get("runs", []) if run.get("status") in {"success", "noop", "failed"}]
    run_kind_counts = Counter(run.get("run_kind", "unknown") for run in zone.get("runs", []))
    recovered_runs = sum(1 for run in execution_runs if run.get("recovered"))
    deferred_spawns = sum(
        1
        for record in decisions
        if record.get("request_type") == "spawn" and record.get("reason_code") == "spawn_budget_exhausted"
    )
    completed_direct = sum(1 for run in execution_runs if run.get("status") in {"success", "noop"} and not run.get("recovered"))
    spawn_requests = [record for record in decisions if record.get("request_type") == "spawn"]
    spawn_allowed = sum(1 for record in spawn_requests if record.get("decision") == "allow")
    spawn_denied = sum(1 for record in spawn_requests if record.get("decision") == "deny")
    outputs_root = zone_sections_root_rel(zone)
    cleanup = zone.get("cleanup_summary", {})
    distinct_request_ids = len({record.get("request_id", "") for record in ledger_records if record.get("request_id")})
    runs_by_task = Counter(run.get("task_id", "") for run in execution_runs if run.get("task_id"))
    failure_runs_by_task = Counter(
        run.get("task_id", "") for run in execution_runs if run.get("task_id") and run.get("status") == "failed"
    )
    retried_tasks = sorted(task_id for task_id, count in runs_by_task.items() if count > 1 and task_id in tasks)
    task_durations = [
        (task["section_slug"], value)
        for task in tasks.values()
        if (value := duration_seconds((task.get("last_run") or {}).get("started_at"), (task.get("last_run") or {}).get("ended_at"))) is not None
    ]
    slowest_tasks = sorted(task_durations, key=lambda item: item[1], reverse=True)[:5]
    peak_running = peak_running_from_events(events)
    timeline_metrics = event_timeline_metrics(events, ordered_task_ids(zone))
    duration_values = [
        value for value in (duration_seconds(run.get("started_at"), run.get("ended_at")) for run in execution_runs) if value is not None
    ]
    duration_summary = summarize_durations(duration_values)
    created_at = zone.get("created_at", "")
    last_harvest_at = latest_event_time(events, "harvest_decision")
    freeze_at = latest_event_time(events, "freeze")
    time_to_first_success_s = duration_seconds(created_at, timeline_metrics["time_to_first_success_at"])
    time_to_full_harvest_s = duration_seconds(created_at, last_harvest_at)
    total_zone_duration_s = duration_seconds(created_at, freeze_at or zone.get("updated_at", ""))
    candidate_count = artifact_counts.get("section_candidate", 0)
    final_count = artifact_counts.get("section_final", 0)
    g_proxy = (spawn_allowed / len(spawn_requests)) if spawn_requests else None
    retry_proxy = (len(execution_runs) / len(tasks)) if tasks else None
    deferred_proxy = (deferred_spawns / len(spawn_requests)) if spawn_requests else None
    assimilation_rate_final_per_hour = (final_count / total_zone_duration_s) * 3600.0 if total_zone_duration_s and total_zone_duration_s > 0 else None
    assimilation_rate_candidate_per_hour = (candidate_count / total_zone_duration_s) * 3600.0 if total_zone_duration_s and total_zone_duration_s > 0 else None
    final_tasks = [task for task in sorted(tasks.values(), key=lambda item: item["section_slug"]) if task.get("status") == "harvested"]
    lines = [
        "section\tzone",
        f"zone_id\t{zone['zone_id']}",
        f"lifecycle_state\t{zone['lifecycle_state']}",
        f"target\t{zone['domain_spec']['target_rel']}",
        f"workspace\t{zone['domain_spec']['workspace']}",
        f"outputs_root\t{outputs_root}",
        "spawn_regime\tsingle-actor-per-partition",
        "topology_kind\tflat",
        "partitioning_strategy\tmarkdown_h2_sections",
        f"partitions_total\t{len(tasks)}",
        "section\ttopology",
        f"actors_total\t{len(zone.get('actors', {}))}",
        f"runs_total\t{len(zone.get('runs', []))}",
        f"execution_runs_total\t{len(execution_runs)}",
        f"execution_run_kinds\t{run_kind_counts.get('execution_run', 0)}",
        f"recovery_run_kinds\t{run_kind_counts.get('recovery_run', 0)}",
        f"harvest_run_kinds\t{run_kind_counts.get('harvest_run', 0)}",
        f"peak_running\t{peak_running}",
        f"completed_direct\t{completed_direct}",
        f"recovered_runs\t{recovered_runs}",
        f"deferred_spawns\t{deferred_spawns}",
        f"retried_tasks\t{len(retried_tasks)}",
        f"retries_total\t{sum(max(count - 1, 0) for count in runs_by_task.values())}",
        "section\tstatus",
        f"status_harvested\t{status_counts.get('harvested', 0)}",
        f"status_success\t{status_counts.get('success', 0)}",
        f"status_noop\t{status_counts.get('noop', 0)}",
        f"status_failed\t{status_counts.get('failed', 0)}",
        f"status_running\t{status_counts.get('running', 0)}",
        f"status_admitted\t{status_counts.get('admitted', 0)}",
        f"status_instantiated\t{status_counts.get('instantiated', 0)}",
        "section\ttimeline",
        f"created_at\t{created_at}",
        f"updated_at\t{zone.get('updated_at', '')}",
        f"first_refine_at\t{earliest_event_time(events, 'refine')}",
        f"first_admit_at\t{earliest_event_time(events, 'task_admitted')}",
        f"first_spawn_at\t{earliest_event_time(events, 'actor_started')}",
        f"first_success_at\t{timeline_metrics['time_to_first_success_at']}",
        f"last_completion_at\t{latest_event_time_any(events, {'transform_completion', 'transform_failure'})}",
        f"last_harvest_at\t{last_harvest_at}",
        f"freeze_at\t{freeze_at}",
        "section\tdurations",
    ]
    if duration_summary is None:
        lines.extend(["run_duration_min_s\t", "run_duration_median_s\t", "run_duration_max_s\t"])
    else:
        lines.extend([f"run_duration_min_s\t{duration_summary[0]:.2f}", f"run_duration_median_s\t{duration_summary[1]:.2f}", f"run_duration_max_s\t{duration_summary[2]:.2f}"])
    lines.extend(
        [
            "section\tpressure",
            f"spawn_budget_total\t{zone.get('budget_state', {}).get('spawn_budget', 0)}",
            f"spawn_pressure_current\t{zone.get('budget_state', {}).get('spawn_pressure_used', 0)}",
            f"spawn_observed_current\t{zone.get('budget_state', {}).get('spawn_observed_used', 0)}",
            f"spawn_requests_total\t{len(spawn_requests)}",
            f"spawn_allowed_total\t{spawn_allowed}",
            f"spawn_denied_total\t{spawn_denied}",
            f"spawn_hard_denied_total\t{max(spawn_denied - deferred_spawns, 0)}",
            f"peak_running_slots\t{peak_running}",
            f"pending_peak\t{timeline_metrics['pending_peak']}",
            f"pending_peak_at\t{timeline_metrics['pending_peak_at']}",
            f"unused_capacity_at_peak\t{max(zone.get('budget_state', {}).get('spawn_budget', 0) - peak_running, 0)}",
            f"deferred_spawn_requests\t{deferred_spawns}",
            f"time_to_first_success_s\t{'' if time_to_first_success_s is None else f'{time_to_first_success_s:.2f}'}",
            f"time_to_full_harvest_s\t{'' if time_to_full_harvest_s is None else f'{time_to_full_harvest_s:.2f}'}",
            f"zone_duration_s\t{'' if total_zone_duration_s is None else f'{total_zone_duration_s:.2f}'}",
            "section\tartifacts",
            f"artifacts_total\t{len(zone.get('artifacts', {}))}",
            f"artifacts_candidate\t{candidate_count}",
            f"artifacts_final\t{final_count}",
            f"anchors_total\t{len(anchors)}",
            "section\tledger",
            f"ledger_records_total\t{len(ledger_records)}",
            f"ledger_seq_min\t{ledger_records[0].get('seq_no', '') if ledger_records else ''}",
            f"ledger_seq_max\t{ledger_records[-1].get('seq_no', '') if ledger_records else ''}",
            f"distinct_request_ids\t{distinct_request_ids}",
            "section\tmembrane",
            f"decisions_total\t{len(decisions)}",
            f"events_total\t{len(events)}",
            "section\tdynamics_proxies",
            "proxy_note\tThese are operational proxies for AI Space Agents dynamics, not canonical theory variables.",
            f"proxy\tN_peak_running\t{peak_running}",
            f"proxy\tG_spawn_admission_ratio\t{'' if g_proxy is None else f'{g_proxy:.4f}'}",
            f"proxy\tretry_factor_execution_runs_per_partition\t{'' if retry_proxy is None else f'{retry_proxy:.4f}'}",
            f"proxy\tdeferred_pressure\t{'' if deferred_proxy is None else f'{deferred_proxy:.4f}'}",
            f"proxy\tI_obs_candidate_artifacts\t{candidate_count}",
            f"proxy\tI_ass_final_artifacts\t{final_count}",
            f"proxy\tB_c_anchor_budget_total\t{zone.get('budget_state', {}).get('anchor_budget', 0)}",
            "proxy_note\tI_obs and I_ass are artifact-count proxies under the current markdown-sections measurement convention.",
            "proxy_note\tB_c is proxied by zone-local anchor budget, not by an external cognitive capacity measure.",
            f"proxy\tassimilation_rate_final_artifacts_per_hour\t{'' if assimilation_rate_final_per_hour is None else f'{assimilation_rate_final_per_hour:.4f}'}",
            f"proxy\tcandidate_rate_per_hour\t{'' if assimilation_rate_candidate_per_hour is None else f'{assimilation_rate_candidate_per_hour:.4f}'}",
            "section\tregime_notes",
            "note\tflat_topology\tno parent-child actor edges were materialized",
            "note\tsingle_writer\tone effective actor per partition was used",
            "note\texperiment_profile\tmarkdown-sections-single-writer",
            "note\tendogenous_spawn\tno runtime-native descendant spawn was used in this zone",
        ]
    )
    for key in sorted(decision_counts):
        lines.append(f"decision\t{key}\t{decision_counts[key]}")
    for key in sorted(decision_reason_counts):
        lines.append(f"reason\t{key}\t{decision_reason_counts[key]}")
    if cleanup:
        lines.append("section\tcleanup")
        for key in ["removed_worktrees", "deleted_branches", "missing_worktrees", "missing_branches", "worktree_errors", "branch_errors"]:
            lines.append(f"cleanup\t{key}\t{cleanup.get(key, 0)}")
    lines.append("section\tactor_lineage")
    for task in sorted(tasks.values(), key=lambda item: item["section_slug"]):
        lines.append(
            "actor\t{}\tpartition={}\tparent={}\tstatus={}".format(
                f"actor:{task['task_id']}",
                task["partition_id"],
                "zone_root",
                zone.get("actors", {}).get(f"actor:{task['task_id']}", {}).get("status", task["status"]),
            )
        )
    lines.append("section\tretry_surface")
    for task_id in retried_tasks:
        task = tasks[task_id]
        lines.append(f"retry\t{task['section_slug']}\truns={runs_by_task[task_id]}\tfailures_before_terminal={failure_runs_by_task[task_id]}")
    lines.append("section\tslowest_partitions")
    for slug, seconds in slowest_tasks:
        lines.append(f"slow\t{slug}\t{seconds:.2f}")
    lines.append("section\tartifact_lineage")
    for task in final_tasks:
        lines.append(
            f"artifact\t{task['section_slug']}\tcandidate={task['candidate_path']}\tfinal={task['final_path']}\tcandidate_commit={task.get('commit', '')}\tfinal_commit={task.get('finalize_commit', '')}"
        )
    lines.append("section\toutputs")
    for task in final_tasks:
        lines.append(f"output\t{task['section_slug']}\t{task['final_path']}")
    return lines


def zone_report_json(repo_root: Path, zone: dict[str, Any], paths: dict[str, Path]) -> dict[str, Any]:
    report: dict[str, Any] = {"sections": {}}
    current_section = ""
    repeated_keys = {"decision", "reason", "cleanup", "note", "proxy", "proxy_note", "actor", "retry", "slow", "artifact", "output"}
    for line in zone_report(repo_root, zone, paths):
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        if parts[0] == "section":
            current_section = parts[1]
            report["sections"].setdefault(current_section, {})
            continue
        if not current_section:
            continue
        bucket = report["sections"].setdefault(current_section, {})
        key = parts[0]
        if key in repeated_keys:
            bucket.setdefault(key, []).append(parts[1:])
        elif len(parts) == 2:
            bucket[key] = parse_scalar(parts[1])
        else:
            bucket[key] = [parse_scalar(item) for item in parts[1:]]
    return report
