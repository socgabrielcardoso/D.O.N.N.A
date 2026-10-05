from __future__ import annotations

import re

_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9._-]{20,}\b"),
]


def redact(text: str) -> str:
    out = text
    for pattern in _PATTERNS:
        out = pattern.sub("[REDACTED]", out)
    return out
