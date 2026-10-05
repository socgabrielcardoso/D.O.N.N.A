from __future__ import annotations

import hashlib
import re
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


@dataclass(slots=True)
class ConversationTurn:
    user_text: str
    assistant_text: str
    provider: str = "unknown"


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
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        return con

    def _init_db(self) -> None:
        with self._connect() as con:
            con.execute("""CREATE TABLE IF NOT EXISTS memory (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                category TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""")
            con.execute("""CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_text TEXT NOT NULL,
                assistant_text TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'unknown',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""")
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_conversations_created_at "
                "ON conversations(created_at DESC)"
            )

    @staticmethod
    def _contains_sensitive(text: str) -> bool:
        lowered = text.lower()
        return any(marker in lowered for marker in SENSITIVE_MARKERS)

    def remember(self, item: MemoryItem) -> bool:
        if self.private_mode:
            return False
        if self._contains_sensitive(f"{item.key} {item.value}"):
            return False
        with self._connect() as con:
            con.execute(
                "INSERT INTO memory(key,value,category) VALUES(?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
                "category=excluded.category, updated_at=CURRENT_TIMESTAMP",
                (item.key, item.value, item.category),
            )
        return True

    def remember_turn(self, turn: ConversationTurn) -> bool:
        if self.private_mode:
            return False
        combined = f"{turn.user_text} {turn.assistant_text}"
        if self._contains_sensitive(combined):
            return False
        with self._connect() as con:
            con.execute(
                "INSERT INTO conversations(user_text,assistant_text,provider) VALUES(?,?,?)",
                (turn.user_text, turn.assistant_text, turn.provider),
            )
            con.execute(
                "DELETE FROM conversations WHERE id NOT IN "
                "(SELECT id FROM conversations ORDER BY id DESC LIMIT 500)"
            )
        return True

    def forget(self, key: str) -> bool:
        with self._connect() as con:
            cur = con.execute("DELETE FROM memory WHERE key=?", (key,))
        return bool(cur.rowcount)

    def forget_matching(self, query: str) -> int:
        pattern = f"%{query}%"
        with self._connect() as con:
            cur = con.execute(
                "DELETE FROM memory WHERE key LIKE ? OR value LIKE ?",
                (pattern, pattern),
            )
        return int(cur.rowcount)

    def get(self, key: str) -> str | None:
        with self._connect() as con:
            row = con.execute("SELECT value FROM memory WHERE key=?", (key,)).fetchone()
        return str(row["value"]) if row else None

    def all(self) -> list[MemoryItem]:
        with self._connect() as con:
            rows = con.execute(
                "SELECT key,value,category FROM memory ORDER BY updated_at DESC"
            ).fetchall()
        return [
            MemoryItem(str(row["key"]), str(row["value"]), str(row["category"]))
            for row in rows
        ]

    def recent_turns(self, limit: int = 8) -> list[ConversationTurn]:
        with self._connect() as con:
            rows = con.execute(
                "SELECT user_text,assistant_text,provider FROM conversations "
                "ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            ConversationTurn(
                str(row["user_text"]),
                str(row["assistant_text"]),
                str(row["provider"]),
            )
            for row in reversed(rows)
        ]

    @staticmethod
    def _tokens(text: str) -> set[str]:
        return {
            token
            for token in re.findall(r"[\wÀ-ÿ-]{3,}", text.lower())
            if token not in {
                "que", "com", "para", "uma", "uns", "das", "dos", "isso", "essa", "esse",
                "donna", "gabriel", "como", "qual", "por", "mais", "muito", "tem", "não", "nao",
            }
        }

    def relevant_context(self, query: str, limit: int = 8) -> str:
        query_tokens = self._tokens(query)
        scored: list[tuple[int, str]] = []

        for item in self.all()[:100]:
            text = f"{item.key} {item.value}"
            score = len(query_tokens & self._tokens(text))
            if score:
                scored.append((score + 3, f"Memória [{item.category}]: {item.value}"))

        for turn in self.recent_turns(30):
            text = f"{turn.user_text} {turn.assistant_text}"
            score = len(query_tokens & self._tokens(text))
            if score:
                scored.append(
                    (score, f"Conversa anterior — Gabriel: {turn.user_text} | D.O.N.N.A.: {turn.assistant_text}")
                )

        scored.sort(key=lambda item: item[0], reverse=True)
        selected = [text for _, text in scored[:limit]]
        if not selected:
            recent = self.recent_turns(4)
            selected = [
                f"Conversa recente — Gabriel: {turn.user_text} | D.O.N.N.A.: {turn.assistant_text}"
                for turn in recent
            ]
        return "\n".join(selected)

    def stats(self) -> dict[str, int]:
        with self._connect() as con:
            memories = int(con.execute("SELECT COUNT(*) FROM memory").fetchone()[0])
            turns = int(con.execute("SELECT COUNT(*) FROM conversations").fetchone()[0])
        return {"memories": memories, "conversation_turns": turns}
