from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PATTERNS = [
    # OpenAI-style credentials are substantially longer than strings such as
    # "vosk-model-small-pt-0.3". Keep hyphens for modern sk-proj-* keys.
    re.compile(r"sk-[A-Za-z0-9_-]{24,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(
        r"(?i)(api[_-]?key|token|password|secret)\s*[:=]\s*['\"][^'\"]{8,}['\"]"
    ),
]

IGNORE = {
    ".git",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    "node_modules",
    ".next",
    "tests",
}

TEXT_SUFFIXES = {
    ".py",
    ".md",
    ".yaml",
    ".yml",
    ".toml",
    ".json",
    ".ps1",
    ".sh",
    ".example",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
}

violations: list[str] = []

for path in ROOT.rglob("*"):
    if not path.is_file() or any(part in IGNORE for part in path.parts):
        continue
    if path.suffix.lower() not in TEXT_SUFFIXES:
        continue

    text = path.read_text(encoding="utf-8", errors="ignore")
    for pattern in PATTERNS:
        if pattern.search(text):
            violations.append(str(path.relative_to(ROOT)))
            break

if violations:
    raise SystemExit("Potential secrets: " + ", ".join(sorted(set(violations))))

print("secret scan: clean")
