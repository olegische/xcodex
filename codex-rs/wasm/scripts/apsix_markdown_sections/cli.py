from __future__ import annotations

import argparse
import sys

from .commands_basic import cmd_admit, cmd_observe, cmd_refine, cmd_zone
from .commands_runtime import cmd_freeze, cmd_harvest, cmd_reconcile, cmd_report, cmd_spawn
from .common import ApsixError
from .constants import DEFAULT_PROFILE, MARKDOWN_SECTIONS_KIND


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="APSIX runtime for Markdown documents partitioned by sections")
    sub = parser.add_subparsers(dest="command", required=True)

    zone_p = sub.add_parser("zone", help="Create a zone around workspace + target")
    zone_p.add_argument("--workspace", default=".", help="Workspace directory")
    zone_p.add_argument("--target", required=True, help="Target path inside workspace or absolute path")
    zone_p.add_argument("--target-kind", default=None, help=f"Target kind, default inferred as '{MARKDOWN_SECTIONS_KIND}'")
    zone_p.add_argument("--profile", default=DEFAULT_PROFILE, help="Codex profile for spawned actors")
    zone_p.add_argument("--date", default=None, help="Zone date (YYYY-MM-DD), default today")
    zone_p.add_argument("--exclude-section", action="append", help="Level-2 section title to exclude")
    zone_p.set_defaults(func=cmd_zone)

    refine_p = sub.add_parser("refine", help="Refine zone into partitions")
    refine_p.add_argument("--zone-id", required=True, help="Zone identifier")
    refine_p.set_defaults(func=cmd_refine)

    admit_p = sub.add_parser("admit", help="Admit partitions into spawn scope")
    admit_p.add_argument("--zone-id", required=True, help="Zone identifier")
    admit_p.add_argument("--all", action="store_true", help="Admit all partitions")
    admit_p.add_argument("--partition", action="append", help="Partition selector: task id, slug, or title")
    admit_p.set_defaults(func=cmd_admit)

    spawn_p = sub.add_parser("spawn", help="Spawn admitted actors for partitions")
    spawn_p.add_argument("--zone-id", required=True, help="Zone identifier")
    spawn_p.add_argument("--partition", action="append", help="Partition selector: task id, slug, or title")
    spawn_p.add_argument("--max-parallel", type=int, default=1, help="Global parallel workers")
    spawn_p.add_argument("--continue-on-error", action="store_true", help="Continue after failure")
    spawn_p.add_argument("--include-unadmitted", action="store_true", help="Bypass admit gate for selected partitions")
    spawn_p.set_defaults(func=cmd_spawn)

    harvest_p = sub.add_parser("harvest", help="Harvest anchored outputs into authoritative workspace state")
    harvest_p.add_argument("--zone-id", required=True, help="Zone identifier")
    harvest_p.add_argument("--partition", action="append", help="Partition selector: task id, slug, or title")
    harvest_p.set_defaults(func=cmd_harvest)

    freeze_p = sub.add_parser("freeze", help="Freeze a zone after harvest/stabilization")
    freeze_p.add_argument("--zone-id", required=True, help="Zone identifier")
    freeze_p.set_defaults(func=cmd_freeze)

    observe_p = sub.add_parser("observe", help="Inspect zone state")
    observe_p.add_argument("--zone-id", required=True, help="Zone identifier")
    observe_p.set_defaults(func=cmd_observe)

    report_p = sub.add_parser("report", help="Summarize zone state and ledger surfaces")
    report_p.add_argument("--zone-id", required=True, help="Zone identifier")
    report_p.add_argument("--json", action="store_true", help="Emit structured JSON report")
    report_p.set_defaults(func=cmd_report)

    reconcile_p = sub.add_parser("reconcile", help="Reconcile interrupted runtime state with real actor/process state")
    reconcile_p.add_argument("--zone-id", required=True, help="Zone identifier")
    reconcile_p.set_defaults(func=cmd_reconcile)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except ApsixError as exc:
        print(f"[ERROR] {exc.phase}: {exc}", file=sys.stderr, flush=True)
        return 1
