from __future__ import annotations

import os
import platform
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any

import psutil

from donna.app.orchestrator.orchestrator import DonnaOrchestrator
from donna.app.voice.stt import HybridSpeechToText
from donna.app.voice.tts import TTSManager


class DonnaNativeBridge:
    """Trusted local bridge exposed only inside the Windows pywebview client."""

    def __init__(self, orchestrator: DonnaOrchestrator, root: Path) -> None:
        self.orchestrator = orchestrator
        self.root = root.resolve()
        self.home = Path.home().resolve()
        self.stt = HybridSpeechToText()
        self.tts = TTSManager(enabled=True)

    def ping(self) -> dict[str, Any]:
        return {
            "ok": True,
            "native": True,
            "platform": platform.platform(),
            "mode": self.orchestrator.mode,
            "version": "0.3",
        }

    def ask(self, text: str) -> dict[str, Any]:
        response = self.orchestrator.handle(text)
        return {
            "text": response.text,
            "state": response.state.value,
            "metadata": response.metadata,
        }

    def listen(self) -> dict[str, Any]:
        try:
            text = self.stt.listen(timeout_seconds=10.0)
            return {
                "ok": bool(text),
                "text": text,
                "engine": self.stt.last_engine,
                "error": self.stt.last_error,
            }
        except Exception as exc:
            return {
                "ok": False,
                "text": "",
                "engine": self.stt.last_engine,
                "error": f"{exc.__class__.__name__}: {exc}",
            }

    def speak(self, text: str) -> dict[str, Any]:
        ok = self.tts.speak(text)
        return {
            "ok": ok,
            "engine": self.tts.last_engine,
            "error": self.tts.last_error,
        }

    def stop_speaking(self) -> dict[str, bool]:
        self.tts.stop()
        return {"ok": True}

    def cancel(self) -> dict[str, bool]:
        self.orchestrator.cancel()
        self.tts.stop()
        return {"ok": True}

    def open_app(self, app: str) -> dict[str, Any]:
        response = self.orchestrator.handle(f"Donna, abra {app}")
        return {"ok": bool(response.metadata.get("ok", True)), "text": response.text}

    def _allowed_path(self, raw: str) -> Path | None:
        try:
            path = Path(raw).expanduser().resolve()
        except OSError:
            return None

        allowed_roots = [self.home, self.root]
        for base in allowed_roots:
            try:
                path.relative_to(base)
                return path
            except ValueError:
                continue
        return None

    def open_path(self, raw: str) -> dict[str, Any]:
        path = self._allowed_path(raw)
        if path is None or not path.exists():
            return {"ok": False, "error": "Caminho fora das áreas permitidas ou inexistente."}

        try:
            if os.name == "nt":
                starter = getattr(os, "startfile", None)
                if starter is None:
                    raise OSError("Windows startfile indisponível")
                starter(str(path))
            else:
                subprocess.Popen(["xdg-open", str(path)])
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": f"{exc.__class__.__name__}: {exc}"}

    def _recent_files(self, limit: int = 18) -> list[dict[str, Any]]:
        candidates: list[Path] = []
        roots = [
            self.home / "Desktop",
            self.home / "Documents",
            self.home / "Downloads",
            self.root,
        ]
        ignored = {".git", ".venv", "node_modules", ".next", "__pycache__"}

        for base in roots:
            if not base.exists():
                continue
            try:
                for path in base.rglob("*"):
                    if not path.is_file():
                        continue
                    if any(part in ignored for part in path.parts):
                        continue
                    try:
                        stat = path.stat()
                    except OSError:
                        continue
                    candidates.append(path)
            except OSError:
                continue

        candidates.sort(
            key=lambda item: item.stat().st_mtime if item.exists() else 0,
            reverse=True,
        )

        result: list[dict[str, Any]] = []
        for path in candidates[:limit]:
            try:
                stat = path.stat()
            except OSError:
                continue
            result.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "ext": path.suffix.lower(),
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                }
            )
        return result

    def _scripts(self, limit: int = 18) -> list[dict[str, Any]]:
        suffixes = {".py", ".ps1", ".js", ".ts", ".tsx", ".sh", ".bat", ".cmd"}
        ignored = {".git", ".venv", "node_modules", ".next", "__pycache__"}
        scripts: list[Path] = []

        for path in self.root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in suffixes:
                continue
            if any(part in ignored for part in path.parts):
                continue
            scripts.append(path)

        scripts.sort(
            key=lambda item: item.stat().st_mtime if item.exists() else 0,
            reverse=True,
        )

        return [
            {
                "name": path.name,
                "path": str(path),
                "kind": path.suffix.lower().lstrip("."),
            }
            for path in scripts[:limit]
        ]

    def _processes(self, limit: int = 14) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for proc in psutil.process_iter(["pid", "name", "memory_percent"]):
            try:
                info = proc.info
                name = str(info.get("name") or "").strip()
                if not name:
                    continue
                items.append(
                    {
                        "pid": int(info.get("pid") or 0),
                        "name": name,
                        "memory": round(float(info.get("memory_percent") or 0.0), 2),
                    }
                )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        items.sort(key=lambda item: float(item["memory"]), reverse=True)
        return items[:limit]

    def snapshot(self) -> dict[str, Any]:
        memory = self.orchestrator.memory.stats()
        virtual = psutil.virtual_memory()
        disk = psutil.disk_usage(str(self.home.anchor or self.home))

        try:
            cpu = psutil.cpu_percent(interval=0.15)
        except Exception:
            cpu = 0.0

        return {
            "native": True,
            "timestamp": time.time(),
            "system": {
                "cpu": round(cpu, 1),
                "memory": round(float(virtual.percent), 1),
                "disk": round(float(disk.percent), 1),
                "host": platform.node(),
                "os": platform.system(),
            },
            "memory": memory,
            "files": self._recent_files(),
            "scripts": self._scripts(),
            "processes": self._processes(),
            "tools": self.orchestrator.tools.names(),
            "mode": self.orchestrator.mode,
        }

    def health(self) -> dict[str, Any]:
        response = self.orchestrator.health_check()
        return {
            "text": response.text,
            "metadata": response.metadata,
        }


class DonnaWebCockpit:
    def __init__(self, orchestrator: DonnaOrchestrator, root: Path) -> None:
        self.orchestrator = orchestrator
        self.root = root
        self.bridge = DonnaNativeBridge(orchestrator, root)
        self.url = os.getenv(
            "DONNA_WEB_URL",
            "https://donna-ai-nine.vercel.app",
        )

    @staticmethod
    def _url_available(url: str) -> bool:
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "D.O.N.N.A.-Windows/0.3"},
            )
            with urllib.request.urlopen(request, timeout=6) as response:
                return 200 <= response.status < 500
        except Exception:
            return False

    def run(self) -> None:
        if not self._url_available(self.url):
            raise RuntimeError("Cockpit Vercel indisponível.")

        import webview

        window = webview.create_window(
            "D.O.N.N.A. — Windows AI Operating Layer",
            self.url,
            js_api=self.bridge,
            width=1440,
            height=920,
            min_size=(1050, 700),
            confirm_close=False,
        )
        webview.start(debug=False, private_mode=False)
        _ = window
