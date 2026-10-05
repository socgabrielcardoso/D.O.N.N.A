from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from pathlib import Path

SENSITIVE_MARKERS = (
    "password", "senha", "api key", "apikey", "token", "secret", "recovery key", "cookie",
    "chave de recuperação", "credencial",
)


@dataclass(slots=True)
class MemoryItem:
    key: str
    value: str
    category: str = "preference"


class MemoryStore:
    def __init__(self, path: Path, private_mode: bool = False) -> None:
        self.path = path
        self.private_mode = private_mode
        path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @staticmethod
    def stable_key(value: str, prefix: str = "note") -> str:
        digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
        return f"{prefix}:{digest}"

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def _init_db(self) -> None:
        with self._connect() as con:
            con.execute("""CREATE TABLE IF NOT EXISTS memory (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                category TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""")

    def remember(self, item: MemoryItem) -> bool:
        if self.private_mode:
            return False
        lowered = f"{item.key} {item.value}".lower()
        if any(marker in lowered for marker in SENSITIVE_MARKERS):
            return False
        with self._connect() as con:
            con.execute(
                "INSERT INTO memory(key,value,category) VALUES(?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, category=excluded.category, updated_at=CURRENT_TIMESTAMP",
                (item.key, item.value, item.category),
            )
        return True

    def forget(self, key: str) -> bool:
        with self._connect() as con:
            cur = con.execute("DELETE FROM memory WHERE key=?", (key,))
        return bool(cur.rowcount)

    def forget_matching(self, query: str) -> int:
        pattern = f"%{query}%"
        with self._connect() as con:
            cur = con.execute("DELETE FROM memory WHERE key LIKE ? OR value LIKE ?", (pattern, pattern))
        return int(cur.rowcount)

    def get(self, key: str) -> str | None:
        with self._connect() as con:
            row = con.execute("SELECT value FROM memory WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def all(self) -> list[MemoryItem]:
        with self._connect() as con:
            rows = con.execute("SELECT key,value,category FROM memory ORDER BY updated_at DESC").fetchall()
        return [MemoryItem(*row) for row in rows]
