from __future__ import annotations

import hashlib
import threading
from datetime import datetime, timezone


PRINT_LOCK = threading.Lock()


class ApsixError(RuntimeError):
    def __init__(self, phase: str, message: str):
        super().__init__(message)
        self.phase = phase


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return utc_now().isoformat()


def today_str() -> str:
    return utc_now().date().isoformat()


def parse_yyyymmdd(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise ApsixError("runtime", f"Invalid date '{value}', expected YYYY-MM-DD") from exc


def log(msg: str) -> None:
    print(f"[INFO] {msg}", flush=True)


def sha1_text(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()
