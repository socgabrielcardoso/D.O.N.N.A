from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from donna.app.memory.store import MemoryItem, MemoryStore


@dataclass(slots=True)
class MemorySeedReport:
    imported: int = 0
    skipped: int = 0
    invalid: int = 0


def import_private_memory_seed(memory: MemoryStore, path: Path) -> MemorySeedReport:
    report = MemorySeedReport()
    if not path.exists():
        return report

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        report.invalid += 1
        return report

    items = payload.get("memories", []) if isinstance(payload, dict) else []
    if not isinstance(items, list):
        report.invalid += 1
        return report

    for raw in items:
        if not isinstance(raw, dict):
            report.invalid += 1
            continue

        value = str(raw.get("value", "")).strip()
        if not value:
            report.invalid += 1
            continue

        category = str(raw.get("category", "profile")).strip() or "profile"
        key = str(raw.get("key", "")).strip()
        if not key:
            key = memory.stable_key(value, prefix=category.replace(" ", "_"))

        if memory.remember(MemoryItem(key=key, value=value, category=category)):
            report.imported += 1
        else:
            report.skipped += 1

    return report
