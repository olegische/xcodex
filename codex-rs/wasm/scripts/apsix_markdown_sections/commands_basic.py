from __future__ import annotations

from pathlib import Path

from .common import ApsixError, log, parse_yyyymmdd, today_str
from .constants import MARKDOWN_SECTIONS_KIND
from .repo_ops import detect_git_root, ensure_tools, resolve_target, resolve_workspace
from .storage import emit_event, event_record, request_id, zone_paths
from .zone_state import (
    admit_tasks,
    build_zone,
    infer_target_kind,
    init_zone_logs,
    load_zone,
    ordered_task_ids,
    refine_markdown_sections,
    resolve_task_ids,
)


def cmd_zone(args) -> int:
    workspace = resolve_workspace(args.workspace)
    repo_root = detect_git_root(workspace)
    ensure_tools(repo_root)
    target = resolve_target(workspace, args.target)
    target_kind = args.target_kind or infer_target_kind(target)
    if target_kind != MARKDOWN_SECTIONS_KIND:
        raise ApsixError("zone", f"Unsupported target kind '{target_kind}'; this runtime supports only '{MARKDOWN_SECTIONS_KIND}'")
    zone = build_zone(
        repo_root,
        workspace,
        target,
        target_kind=target_kind,
        run_date=parse_yyyymmdd(args.date) if args.date else today_str(),
        profile=args.profile,
        excluded_titles=list(args.exclude_section or ["Abstract", "References"]),
    )
    paths = zone_paths(repo_root, zone["zone_id"])
    if paths["zone"].exists():
        raise ApsixError("zone", f"Zone already exists: {zone['zone_id']}")
    init_zone_logs(zone, paths)
    zone_request_id = request_id(zone["zone_id"], "zone", zone["zone_id"])
    emit_event(
        zone,
        paths,
        event_record(
            zone,
            event_type="zone_created",
            subject_ref=zone["zone_id"],
            request_id_value=zone_request_id,
            payload={"workspace": str(workspace), "target": str(target), "target_kind": target_kind},
        ),
    )
    from .zone_state import persist_zone

    persist_zone(zone, paths)
    print(zone["zone_id"])
    return 0


def cmd_refine(args) -> int:
    zone, paths = load_zone(detect_git_root(Path.cwd()), args.zone_id)
    if zone["domain_spec"]["kind"] != MARKDOWN_SECTIONS_KIND:
        raise ApsixError("refine", f"Unsupported target kind: {zone['domain_spec']['kind']}")
    created = refine_markdown_sections(zone, paths)
    log(f"refined zone={zone['zone_id']} partitions={len(zone['tasks'])} created={created}")
    return 0


def cmd_admit(args) -> int:
    zone, paths = load_zone(detect_git_root(Path.cwd()), args.zone_id)
    if not zone["tasks"]:
        raise ApsixError("admit", "Zone has no partitions; run refine first")
    selectors = [] if args.all else list(args.partition or [])
    if not args.all and not selectors:
        raise ApsixError("admit", "Use --all or provide one or more --partition")
    task_ids = resolve_task_ids(zone, selectors) if selectors else ordered_task_ids(zone)
    changed = admit_tasks(zone, paths, task_ids, "manual_admit")
    log(f"admitted zone={zone['zone_id']} changed={changed}")
    return 0


def cmd_observe(args) -> int:
    zone, _ = load_zone(detect_git_root(Path.cwd()), args.zone_id)
    print(f"zone_id\t{zone['zone_id']}")
    print(f"target_kind\t{zone['domain_spec']['kind']}")
    print(f"target\t{zone['domain_spec']['target_rel']}")
    print(f"workspace\t{zone['domain_spec']['workspace']}")
    print(f"lifecycle_state\t{zone['lifecycle_state']}")
    print(f"spawn_budget_pressure\t{zone['budget_state']['spawn_pressure_used']}/{zone['budget_state']['spawn_budget']}")
    print(f"spawn_budget_observed\t{zone['budget_state']['spawn_observed_used']}/{zone['budget_state']['spawn_budget']}")
    print(f"anchor_budget\t{zone['budget_state']['anchor_used']}/{zone['budget_state']['anchor_budget']}")
    for task_id in ordered_task_ids(zone):
        task = zone["tasks"][task_id]
        actor = zone.get("actors", {}).get(f"actor:{task_id}", {})
        pid = actor.get("pid") if task["status"] == "running" else ""
        print(f"partition\t{task_id}\t{task['section_slug']}\t{task['status']}\t{'admitted' if task['admitted'] else 'pending'}\t{pid}")
    return 0
