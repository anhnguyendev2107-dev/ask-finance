"""Append-only JSONL audit log for every user query + tool invocation.

In production this would write to an immutable log (CloudWatch, Splunk, etc.)
and be the foundation of security-compliance reporting.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from .config import AUDIT_LOG_PATH


def log(event_type: str, user_id: str, payload: dict[str, Any]) -> None:
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event_type,
        "user_id": user_id,
        **payload,
    }
    with AUDIT_LOG_PATH.open("a") as f:
        f.write(json.dumps(record, default=str) + "\n")
