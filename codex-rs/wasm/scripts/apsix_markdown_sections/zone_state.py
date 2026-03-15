from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .common import ApsixError, now_iso, sha1_text, slugify
from .constants import APSIX_POLICY_VERSION, APSIX_SCHEMA_VERSION, MARKDOWN_SECTIONS_KIND, ZONE_STATES
from .storage import (
    emit_decision,
    emit_event,
    ensure_budget_state,
    ensure_ledger_state,
    event_record,
    load_json_file,
    membrane_decision_record,
    persist_manifest,
    request_id,
    write_json_file,
    zone_paths,
)


def infer_target_kind(target: Path) -> str:
    if target.is_file() and target.suffix.lower() == ".md":
        return MARKDOWN_SECTIONS_KIND
    raise ApsixError("pre", f"Could not infer target kind for {target}")


def target_slug(target: Path) -> str:
    return slugify(target.stem)


def zone_id_for(target: Path, run_date: str) -> str:
    digest = sha1_text(str(target.resolve()))[:8]
    return f"apsix-{target_slug(target)}-{run_date}-{digest}"


def infer_sections_root(target: Path) -> Path:
    if target.parent.name == "draft" and target.parent.parent.exists():
        return target.parent.parent / "sections"
    return target.parent / "sections"


def workspace_sections_root(workspace: Path) -> Path:
    return workspace / "sections"


def infer_output_spec(repo_root: Path, target: Path) -> dict[str, str]:
    sections_root = infer_sections_root(target)
    return {
        "boundary_kind": "document_local_sections",
        "sections_root": str(sections_root),
        "sections_root_rel": sections_root.relative_to(repo_root).as_posix(),
    }


def zone_sections_root_rel(zone: dict[str, Any]) -> str:
    output_spec = zone.get("output_spec", {})
    sections_root_rel = output_spec.get("sections_root_rel", "")
    if sections_root_rel:
        return sections_root_rel
    repo_root = Path(zone["domain_spec"]["repo_root"])
    target = Path(zone["domain_spec"]["target"])
    inferred = infer_output_spec(repo_root, target)
    zone["output_spec"] = inferred
    return inferred["sections_root_rel"]


def zone_sections_root_abs(zone: dict[str, Any]) -> Path:
    return Path(zone["domain_spec"]["repo_root"]) / zone_sections_root_rel(zone)


def parse_markdown_sections(draft_path: Path, excluded_titles: set[str]) -> list[dict[str, str]]:
    sections: list[dict[str, str]] = []
    for line in draft_path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^##\s+(.+?)\s*$", line)
        if not match:
            continue
        title = match.group(1).strip()
        if title in excluded_titles:
            continue
        sections.append({"title": title, "slug": slugify(title)})
    return sections


def build_zone(
    repo_root: Path,
    workspace: Path,
    target: Path,
    *,
    target_kind: str,
    run_date: str,
    profile: str,
    excluded_titles: list[str],
) -> dict[str, Any]:
    zone_id = zone_id_for(target, run_date)
    zone = {
        "schema_version": APSIX_SCHEMA_VERSION,
        "zone_id": zone_id,
        "domain_spec": {
            "kind": target_kind,
            "workspace": str(workspace),
            "repo_root": str(repo_root),
            "target": str(target),
            "target_rel": target.relative_to(repo_root).as_posix(),
            "date": run_date,
        },
        "output_spec": infer_output_spec(repo_root, target),
        "lifecycle_state": "open",
        "membrane_policy_version": APSIX_POLICY_VERSION,
        "budget_state": {
            "spawn_budget": 0,
            "spawn_pressure_used": 0,
            "spawn_observed_used": 0,
            "anchor_budget": 0,
            "anchor_used": 0,
        },
        "selection": {
            "generated_at": now_iso(),
            "profile": profile,
            "policy": {
                "excluded_section_titles": excluded_titles,
                "worktree_prefix": f".worktrees/apsix/{zone_id}",
                "branch_prefix": f"codex/apsix/{zone_id}/",
            },
            "summary": {},
        },
        "partition_state": {"task_partitions": []},
        "task_order": [],
        "tasks": {},
        "actors": {},
        "artifacts": {},
        "runs": [],
        "run_counters": {
            "execution_runs_total": 0,
            "recovery_runs_total": 0,
            "harvest_runs_total": 0,
        },
        "authoritative_state_ref": {},
        "log_refs": {"events_path": "", "decisions_path": "", "anchors_path": ""},
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    ensure_ledger_state(zone)
    return zone


def persist_zone(zone: dict[str, Any], paths: dict[str, Path]) -> None:
    ensure_ledger_state(zone)
    zone["updated_at"] = now_iso()
    write_json_file(paths["zone"], zone)
    persist_manifest(zone, paths)


def init_zone_logs(zone: dict[str, Any], paths: dict[str, Path]) -> None:
    ensure_ledger_state(zone)
    zone["authoritative_state_ref"] = {
        "zone_path": str(paths["zone"]),
        "schema_version": APSIX_SCHEMA_VERSION,
    }
    zone["log_refs"] = {
        "manifest_path": str(paths["manifest"]),
        "events_path": str(paths["events"]),
        "decisions_path": str(paths["decisions"]),
        "anchors_path": str(paths["anchors"]),
    }
    persist_zone(zone, paths)
    for log_path in (paths["events"], paths["decisions"], paths["anchors"]):
        log_path.write_text("", encoding="utf-8")
    persist_manifest(zone, paths)


def validate_zone(zone: dict[str, Any], paths: dict[str, Path]) -> None:
    ensure_ledger_state(zone)
    if zone.get("schema_version") != APSIX_SCHEMA_VERSION:
        raise ApsixError("runtime", "Unsupported APSIX zone schema_version")
    if zone.get("zone_id") != paths["root"].name:
        raise ApsixError("runtime", "Zone ID/path mismatch")
    if zone.get("lifecycle_state") not in ZONE_STATES:
        raise ApsixError("runtime", f"Invalid zone lifecycle_state: {zone.get('lifecycle_state')}")
    if not isinstance(zone.get("tasks"), dict):
        raise ApsixError("runtime", "APSIX zone missing tasks")


def load_zone(repo_root: Path, zone_id: str) -> tuple[dict[str, Any], dict[str, Path]]:
    paths = zone_paths(repo_root, zone_id)
    if not paths["zone"].is_file():
        raise ApsixError("runtime", f"Zone not found: {zone_id}")
    zone = load_json_file(paths["zone"])
    validate_zone(zone, paths)
    persist_manifest(zone, paths)
    return zone, paths


def ordered_task_ids(zone: dict[str, Any]) -> list[str]:
    task_order = zone.get("task_order", [])
    tasks = zone.get("tasks", {})
    ordered = [task_id for task_id in task_order if task_id in tasks]
    if len(ordered) != len(task_order) or set(ordered) != set(tasks.keys()):
        raise ApsixError("runtime", "APSIX zone task_order is inconsistent")
    return ordered


def task_partition_id(task_id: str) -> str:
    return f"task:{task_id}"


def sync_task_partition_state(
    zone: dict[str, Any],
    task_id: str,
    *,
    status: str | None = None,
    admitted: bool | None = None,
) -> None:
    partition_id = zone["tasks"][task_id]["partition_id"]
    for partition in zone["partition_state"]["task_partitions"]:
        if partition["partition_id"] != partition_id:
            continue
        if status is not None:
            partition["status"] = status
        if admitted is not None:
            partition["admitted"] = admitted
        return
    raise ApsixError("runtime", f"Partition not found: {partition_id}")


def recompute_spawn_used(zone: dict[str, Any]) -> None:
    ensure_budget_state(zone)
    active_statuses = {"running", "success", "noop", "harvested"}
    pressure_reservations = sum(
        1
        for task in zone["tasks"].values()
        if task.get("status") == "admitted" and task.get("active_run_id")
    )
    zone["budget_state"]["spawn_pressure_used"] = pressure_reservations + sum(
        1 for task in zone["tasks"].values() if task.get("status") == "running"
    )
    zone["budget_state"]["spawn_observed_used"] = sum(
        1 for task in zone["tasks"].values() if task.get("status") in active_statuses
    )


def budget_context_snapshot(zone: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    context = dict(zone.get("budget_state", {}))
    context.update(overrides)
    return context


def build_markdown_task(zone: dict[str, Any], section: dict[str, str]) -> dict[str, Any]:
    branch_prefix = zone["selection"]["policy"]["branch_prefix"]
    worktree_prefix = zone["selection"]["policy"]["worktree_prefix"]
    task_id = sha1_text(f"{zone['zone_id']}:{section['slug']}")[:10]
    sections_root_rel = zone_sections_root_rel(zone)
    section_dir_rel = f"{sections_root_rel}/{section['slug']}"
    return {
        "task_id": task_id,
        "partition_id": task_partition_id(task_id),
        "section_title": section["title"],
        "section_slug": section["slug"],
        "status": "instantiated",
        "admitted": False,
        "branch": f"{branch_prefix}{section['slug']}",
        "worktree_rel": f"{worktree_prefix}/{section['slug']}",
        "candidate_path": f"{section_dir_rel}/section.md",
        "candidate_dir": section_dir_rel,
        "final_path": f"{sections_root_rel}/{section['slug']}.md",
        "commit": "",
        "finalize_commit": "",
        "last_run": None,
        "active_request_id": "",
        "active_run_id": "",
    }


def resolve_final_output_rel(zone: dict[str, Any], task: dict[str, Any]) -> str:
    return f"{zone_sections_root_rel(zone)}/{task['section_slug']}.md"


def refine_markdown_sections(zone: dict[str, Any], paths: dict[str, Path]) -> int:
    if zone["partition_state"]["task_partitions"]:
        return 0
    draft_path = Path(zone["domain_spec"]["target"])
    excluded = set(zone["selection"]["policy"]["excluded_section_titles"])
    sections = parse_markdown_sections(draft_path, excluded)
    if not sections:
        raise ApsixError("refine", "No level-2 sections found in target")
    for section in sections:
        task = build_markdown_task(zone, section)
        zone["tasks"][task["task_id"]] = task
        zone["task_order"].append(task["task_id"])
        zone["partition_state"]["task_partitions"].append(
            {
                "partition_id": task["partition_id"],
                "zone_id": zone["zone_id"],
                "scope_ref": {
                    "section_title": task["section_title"],
                    "section_slug": task["section_slug"],
                    "candidate_path": task["candidate_path"],
                    "final_path": task["final_path"],
                },
                "status": task["status"],
                "admitted": False,
            }
        )
    zone["budget_state"]["spawn_budget"] = max(len(sections), 1)
    zone["budget_state"]["anchor_budget"] = max(len(sections) * 2, 1)
    recompute_spawn_used(zone)
    zone["selection"]["summary"] = {"partition_count": len(sections), "refined_at": now_iso()}
    refine_request_id = request_id(zone["zone_id"], "refine", zone["zone_id"])
    emit_event(
        zone,
        paths,
        event_record(
            zone,
            event_type="refine",
            subject_ref=zone["zone_id"],
            request_id_value=refine_request_id,
            payload={"partition_count": len(sections), "strategy": "markdown_h2_sections"},
        ),
    )
    persist_zone(zone, paths)
    return len(sections)


def resolve_task_ids(zone: dict[str, Any], selectors: list[str]) -> list[str]:
    if not selectors:
        return ordered_task_ids(zone)
    matched: list[str] = []
    for selector in selectors:
        selector = selector.strip()
        if not selector:
            continue
        candidates = []
        for task_id in ordered_task_ids(zone):
            task = zone["tasks"][task_id]
            if selector in {task_id, task["section_slug"], task["section_title"]}:
                candidates.append(task_id)
            elif task_id.startswith(selector) or task["section_slug"].startswith(selector):
                candidates.append(task_id)
        candidates = sorted(set(candidates))
        if not candidates:
            raise ApsixError("runtime", f"Partition selector not found: {selector}")
        if len(candidates) > 1:
            raise ApsixError("runtime", f"Ambiguous partition selector: {selector}")
        if candidates[0] not in matched:
            matched.append(candidates[0])
    return matched


def admit_tasks(zone: dict[str, Any], paths: dict[str, Path], task_ids: list[str], reason_code: str) -> int:
    repo_root = Path(zone["domain_spec"]["repo_root"])
    changed = 0
    for task_id in task_ids:
        task = zone["tasks"][task_id]
        admit_request_id = request_id(zone["zone_id"], "admit", task_id)
        final_abs = repo_root / task["final_path"]
        if final_abs.exists():
            decision = membrane_decision_record(
                zone,
                request_type="admit",
                subject_ref=task_id,
                decision="deny",
                reason_code="final_artifact_exists",
                capability_basis={"capabilities": ["spawn"], "partition_id": task["partition_id"]},
                budget_context=zone["budget_state"],
                request_id_value=admit_request_id,
            )
            emit_decision(zone, paths, decision)
            emit_event(
                zone,
                paths,
                event_record(
                    zone,
                    event_type="task_admission_denied",
                    subject_ref=task_id,
                    request_id_value=admit_request_id,
                    payload={
                        "decision_id": decision["decision_id"],
                        "reason_code": "final_artifact_exists",
                        "final_path": task["final_path"],
                    },
                ),
            )
            continue
        if task["admitted"]:
            continue
        task["admitted"] = True
        sync_task_partition_state(zone, task_id, admitted=True)
        decision = membrane_decision_record(
            zone,
            request_type="admit",
            subject_ref=task_id,
            decision="allow",
            reason_code=reason_code,
            capability_basis={"capabilities": ["spawn"], "partition_id": task["partition_id"]},
            budget_context=zone["budget_state"],
            request_id_value=admit_request_id,
        )
        emit_decision(zone, paths, decision)
        emit_event(
            zone,
            paths,
            event_record(
                zone,
                event_type="task_admitted",
                subject_ref=task_id,
                request_id_value=admit_request_id,
                payload={"decision_id": decision["decision_id"], "admitted": True},
            ),
        )
        changed += 1
    if changed:
        recompute_spawn_used(zone)
        persist_zone(zone, paths)
    return changed
