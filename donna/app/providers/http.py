from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from donna.app.providers.base import ModelProvider


class OpenAIProvider(ModelProvider):
    name = "openai"

    def available(self) -> bool:
        return bool(os.getenv("OPENAI_API_KEY"))

    def complete(self, system: str, user: str, timeout: float = 30.0) -> str:
        key = os.environ["OPENAI_API_KEY"]
        base = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        model = os.getenv("OPENAI_MODEL", "gpt-6-luna")
        payload = json.dumps({
            "model": model,
            "instructions": system,
            "input": user,
            "store": False,
        }).encode()
        request = urllib.request.Request(
            f"{base}/responses",
            data=payload,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.load(response)
        if isinstance(data.get("output_text"), str):
            return data["output_text"]
        chunks: list[str] = []
        for item in data.get("output", []):
            if item.get("type") != "message":
                continue
            for part in item.get("content", []):
                if part.get("type") == "output_text" and part.get("text"):
                    chunks.append(str(part["text"]))
        if not chunks:
            raise RuntimeError("OpenAI response contained no output_text")
        return "\n".join(chunks)


class OllamaProvider(ModelProvider):
    name = "ollama"

    @staticmethod
    def _base_url() -> str:
        return os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")

    def _server_available(self, timeout: float = 0.5) -> bool:
        try:
            with urllib.request.urlopen(f"{self._base_url()}/api/tags", timeout=timeout) as response:
                return 200 <= response.status < 300
        except Exception:
            return False

    @staticmethod
    def _find_ollama() -> str | None:
        found = shutil.which("ollama")
        if found:
            return found

        local_app_data = os.getenv("LOCALAPPDATA")
        candidates: list[Path] = []
        if local_app_data:
            candidates.extend(
                [
                    Path(local_app_data) / "Programs" / "Ollama" / "ollama.exe",
                    Path(local_app_data) / "Ollama" / "ollama.exe",
                ]
            )

        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return None

    def _start_local_server(self) -> bool:
        executable = self._find_ollama()
        if not executable:
            return False

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            subprocess.Popen(
                [executable, "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
        except OSError:
            return False

        for _ in range(10):
            if self._server_available(timeout=0.35):
                return True
            time.sleep(0.35)
        return False

    def available(self) -> bool:
        if self._server_available():
            return True
        return self._start_local_server()

    def complete(self, system: str, user: str, timeout: float = 30.0) -> str:
        base = self._base_url()
        model = os.getenv("OLLAMA_MODEL", "qwen3:4b")
        payload = json.dumps({
            "model": model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }).encode()
        request = urllib.request.Request(
            f"{base}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.load(response)
        return str(data["message"]["content"])


class LocalFallbackProvider(ModelProvider):
    name = "local"

    def available(self) -> bool:
        return True

    def complete(self, system: str, user: str, timeout: float = 30.0) -> str:
        return (
            "O cérebro generativo local não respondeu. As ferramentas locais continuam disponíveis; "
            "verifique se o Ollama está instalado e se o modelo qwen3:4b está disponível."
        )
