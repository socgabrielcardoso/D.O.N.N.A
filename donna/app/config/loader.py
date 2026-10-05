from __future__ import annotations

import os
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml


def _merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = value
    return result


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


class Config:
    def __init__(self, data: dict[str, Any], root: Path) -> None:
        self.data = data
        self.root = root

    def get(self, dotted: str, default: Any = None) -> Any:
        cur: Any = self.data
        for part in dotted.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur

    def set(self, dotted: str, value: Any, persist: bool = False) -> None:
        parts = dotted.split(".")
        cur = self.data
        for part in parts[:-1]:
            next_value = cur.get(part)
            if not isinstance(next_value, dict):
                next_value = {}
                cur[part] = next_value
            cur = next_value
        cur[parts[-1]] = value
        if persist:
            self.save_user()

    def path(self, dotted: str) -> Path:
        value = str(self.get(dotted))
        path = Path(value)
        return path if path.is_absolute() else self.root / path

    def save_user(self) -> None:
        user = {
            "assistant": {
                "mode": self.get("assistant.mode", "NORMAL"),
                "private_mode": bool(self.get("assistant.private_mode", False)),
                "lite_mode": bool(self.get("assistant.lite_mode", False)),
            },
            "features": {
                "wake_word": bool(self.get("features.wake_word", False)),
                "vision": bool(self.get("features.vision", True)),
                "browser_agent": bool(self.get("features.browser_agent", False)),
                "proactive_mode": bool(self.get("features.proactive_mode", False)),
                "local_llm": bool(self.get("features.local_llm", True)),
            },
            "voice": {
                "enabled": bool(self.get("voice.enabled", True)),
                "wake_word": self.get("voice.wake_word", "Donna"),
                "aliases": self.get("voice.aliases", ["Donna"]),
            },
            "providers": {
                "default": self.get("providers.default", "ollama"),
                "fallback": self.get("providers.fallback", ["openai", "local"]),
                "timeout_seconds": self.get("providers.timeout_seconds", 30),
            },
        }
        with (self.root / "user.yaml").open("w", encoding="utf-8") as fh:
            yaml.safe_dump(user, fh, sort_keys=False, allow_unicode=True)


def load_yaml_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return data if isinstance(data, dict) else {}


def load_config(root: Path | None = None) -> Config:
    root = root or Path.cwd()
    _load_dotenv(root / ".env")
    default_path = Path(__file__).with_name("default.yaml")
    with default_path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    user_path = root / "user.yaml"
    if user_path.exists():
        with user_path.open("r", encoding="utf-8") as fh:
            data = _merge(data, yaml.safe_load(fh) or {})
    mode = os.getenv("DONNA_MODE")
    if mode:
        data.setdefault("assistant", {})["mode"] = mode.upper()
    return Config(data, root)
