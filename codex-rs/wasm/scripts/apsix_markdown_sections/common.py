from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import re

from apsix_shared.common import ApsixError, PRINT_LOCK, log, now_iso, parse_yyyymmdd, sha1_text, today_str, utc_now


def stream_line(prefix: str, line: str) -> None:
    with PRINT_LOCK:
        print(f"[{prefix}] {line}", end="", flush=True)


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = value.strip("-")
    return value or "target"


def parse_iso_or_none(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def duration_seconds(started_at: str | None, ended_at: str | None) -> float | None:
    start_dt = parse_iso_or_none(started_at)
    end_dt = parse_iso_or_none(ended_at)
    if start_dt is None or end_dt is None:
        return None
    return max((end_dt - start_dt).total_seconds(), 0.0)


def summarize_durations(values: list[float]) -> tuple[float, float, float] | None:
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    median = ordered[mid] if n % 2 == 1 else (ordered[mid - 1] + ordered[mid]) / 2.0
    return ordered[0], median, ordered[-1]


def parse_scalar(value: str) -> Any:
    if value == "":
        return ""
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value
