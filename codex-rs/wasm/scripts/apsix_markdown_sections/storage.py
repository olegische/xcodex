from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .common import ApsixError, now_iso, sha1_text
from .constants import (
    APSIX_MEASUREMENT_PROFILE,
    APSIX_RUNTIME_PROFILE,
    APSIX_SCHEMA_VERSION,
    STATE_ROOT_NAME,
)


def write_json_file(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=True, indent=2, sort_keys=True)
        handle.write("\n")


def load_json_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ApsixError("runtime", f"JSON file not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ApsixError("runtime", f"Invalid JSON: {path} ({exc})") from exc


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=True, sort_keys=True) + "\n")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        records.append(json.loads(line))
    return records


def zone_storage_root(repo_root: Path) -> Path:
    return repo_root / STATE_ROOT_NAME


def zone_paths(repo_root: Path, zone_id: str) -> dict[str, Path]:
    root = zone_storage_root(repo_root) / zone_id
    root.mkdir(parents=True, exist_ok=True)
    return {
        "root": root,
        "zone": root / "apsix_zone.json",
        "manifest": root / "ledger_manifest.json",
        "events": root / "apsix_events.jsonl",
        "decisions": root / "apsix_membrane_decisions.jsonl",
        "anchors": root / "apsix_anchors.jsonl",
    }


def event_id(zone_id: str, event_type: str, subject_ref: str) -> str:
    return sha1_text(f"{zone_id}:event:{event_type}:{subject_ref}:{now_iso()}")[:12]


def decision_id(zone_id: str, request_type: str, subject_ref: str) -> str:
    return sha1_text(f"{zone_id}:decision:{request_type}:{subject_ref}:{now_iso()}")[:12]


def anchor_id(zone_id: str, artifact_id: str) -> str:
    return sha1_text(f"{zone_id}:anchor:{artifact_id}:{now_iso()}")[:12]


def request_id(zone_id: str, request_type: str, subject_ref: str) -> str:
    return sha1_text(f"{zone_id}:request:{request_type}:{subject_ref}:{now_iso()}")[:12]


def run_id(zone_id: str, task_id: str) -> str:
    return sha1_text(f"{zone_id}:run:{task_id}:{now_iso()}")[:12]


def ensure_measurement_convention(zone: dict[str, Any]) -> None:
    zone.setdefault(
        "measurement_convention",
        {
            "profile": APSIX_MEASUREMENT_PROFILE,
            "I_obs_proxy": "section_candidate_anchors",
            "I_ass_proxy": "section_final_anchors",
            "B_c_proxy": "zone_anchor_budget_total",
            "N_proxy": "peak_running_actor_count",
            "G_proxy": "spawn_allow_over_spawn_requests",
            "retry_proxy": "execution_runs_over_partitions",
            "notes": [
                "These are operational proxies for AI Space Agents dynamics.",
                "They are not canonical theory variables.",
            ],
        },
    )


def ensure_budget_state(zone: dict[str, Any]) -> None:
    budget_state = zone.setdefault("budget_state", {})
    budget_state.setdefault("spawn_budget", 0)
    budget_state.setdefault("spawn_pressure_used", 0)
    budget_state.setdefault("spawn_observed_used", 0)
    budget_state.setdefault("anchor_budget", 0)
    budget_state.setdefault("anchor_used", 0)


def ensure_ledger_state(zone: dict[str, Any]) -> None:
    ledger_state = zone.setdefault("ledger_state", {})
    ledger_state.setdefault("next_seq_no", 1)
    ledger_state.setdefault("record_schema_version", APSIX_SCHEMA_VERSION)
    zone.setdefault("ledger_profiles", {"runtime": APSIX_RUNTIME_PROFILE})
    ensure_budget_state(zone)
    ensure_measurement_convention(zone)


def next_seq_no(zone: dict[str, Any]) -> int:
    ensure_ledger_state(zone)
    value = int(zone["ledger_state"]["next_seq_no"])
    zone["ledger_state"]["next_seq_no"] = value + 1
    return value


def append_ledger_record(
    zone: dict[str, Any],
    *,
    ledger_kind: str,
    path: Path,
    record: dict[str, Any],
) -> dict[str, Any]:
    record = dict(record)
    record.setdefault("schema_version", zone["ledger_state"]["record_schema_version"])
    record.setdefault("zone_id", zone["zone_id"])
    record["ledger_kind"] = ledger_kind
    record["seq_no"] = next_seq_no(zone)
    append_jsonl(path, record)
    return record


def emit_event(zone: dict[str, Any], paths: dict[str, Path], record: dict[str, Any]) -> dict[str, Any]:
    return append_ledger_record(zone, ledger_kind="event", path=paths["events"], record=record)


def emit_decision(zone: dict[str, Any], paths: dict[str, Path], record: dict[str, Any]) -> dict[str, Any]:
    return append_ledger_record(zone, ledger_kind="decision", path=paths["decisions"], record=record)


def emit_anchor(zone: dict[str, Any], paths: dict[str, Path], record: dict[str, Any]) -> dict[str, Any]:
    return append_ledger_record(zone, ledger_kind="anchor", path=paths["anchors"], record=record)


def ledger_manifest(zone: dict[str, Any], paths: dict[str, Path]) -> dict[str, Any]:
    ensure_ledger_state(zone)
    return {
        "schema_version": APSIX_SCHEMA_VERSION,
        "zone_id": zone["zone_id"],
        "policy_version": zone["membrane_policy_version"],
        "runtime_profile": zone.get("ledger_profiles", {}).get("runtime", ""),
        "measurement_convention": zone.get("measurement_convention", {}),
        "paths": {
            "zone": str(paths["zone"]),
            "manifest": str(paths["manifest"]),
            "events": str(paths["events"]),
            "decisions": str(paths["decisions"]),
            "anchors": str(paths["anchors"]),
        },
    }


def persist_manifest(zone: dict[str, Any], paths: dict[str, Path]) -> None:
    write_json_file(paths["manifest"], ledger_manifest(zone, paths))


def event_record(
    zone: dict[str, Any],
    *,
    event_type: str,
    subject_ref: str,
    payload: dict[str, Any],
    request_id_value: str = "",
    run_id_value: str = "",
) -> dict[str, Any]:
    return {
        "event_id": event_id(zone["zone_id"], event_type, subject_ref),
        "zone_id": zone["zone_id"],
        "event_type": event_type,
        "subject_ref": subject_ref,
        "timestamp_or_order": now_iso(),
        "request_id": request_id_value,
        "run_id": run_id_value,
        "payload": payload,
    }


def membrane_decision_record(
    zone: dict[str, Any],
    *,
    request_type: str,
    subject_ref: str,
    decision: str,
    reason_code: str,
    capability_basis: dict[str, Any],
    budget_context: dict[str, Any],
    request_id_value: str,
) -> dict[str, Any]:
    return {
        "decision_id": decision_id(zone["zone_id"], request_type, subject_ref),
        "zone_id": zone["zone_id"],
        "request_type": request_type,
        "request_id": request_id_value,
        "subject_ref": subject_ref,
        "decision": decision,
        "policy_version": zone["membrane_policy_version"],
        "reason_code": reason_code,
        "capability_basis": capability_basis,
        "budget_context": budget_context,
        "timestamp_or_order": now_iso(),
    }
