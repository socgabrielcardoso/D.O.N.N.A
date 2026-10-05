from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from donna.app.providers.base import ModelProvider


class OpenAIProvider(ModelProvider):
    name = "openai"

    def __init__(self) -> None:
        self.last_error = ""

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
        try:
            with urllib.request.urlopen(request, timeout=max(timeout, 60.0)) as response:
                data = json.load(response)
        except Exception as exc:
            self.last_error = f"{exc.__class__.__name__}: {exc}"
            raise
        if isinstance(data.get("output_text"), str):
            self.last_error = ""
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
        self.last_error = ""
        return "\n".join(chunks)


class OllamaProvider(ModelProvider):
    name = "ollama"

    def __init__(self) -> None:
        self.last_error = ""
        self.last_transport = "none"

    @staticmethod
    def _base_url() -> str:
        return os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")

    @staticmethod
    def model_name() -> str:
        return os.getenv("OLLAMA_MODEL", "qwen3:4b")

    def _server_available(self, timeout: float = 0.75) -> bool:
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

    def installed_models(self) -> list[str]:
        try:
            with urllib.request.urlopen(f"{self._base_url()}/api/tags", timeout=1.5) as response:
                data = json.load(response)
            names = [str(item.get("name", "")) for item in data.get("models", [])]
            return [name for name in names if name]
        except Exception:
            pass

        executable = self._find_ollama()
        if not executable:
            return []
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            completed = subprocess.run(
                [executable, "list"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=12,
                creationflags=creationflags,
            )
            if completed.returncode != 0:
                return []
            lines = completed.stdout.splitlines()[1:]
            return [line.split()[0] for line in lines if line.split()]
        except Exception:
            return []

    def _start_local_server(self) -> bool:
        executable = self._find_ollama()
        if not executable:
            self.last_error = "ollama.exe não encontrado"
            return False

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            subprocess.Popen(
                [executable, "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
        except OSError as exc:
            self.last_error = f"Falha iniciando Ollama: {exc}"
            return False

        for _ in range(24):
            if self._server_available(timeout=0.5):
                return True
            time.sleep(0.35)
        self.last_error = "Ollama não abriu a porta 11434 a tempo"
        return False

    def available(self) -> bool:
        if self._server_available():
            return True
        if self._start_local_server():
            return True
        return self._find_ollama() is not None

    def model_available(self) -> bool:
        wanted = self.model_name().lower()
        models = [name.lower() for name in self.installed_models()]
        return any(name == wanted or name.startswith(f"{wanted}:") for name in models)

    def _http_complete(self, system: str, user: str, timeout: float) -> str:
        base = self._base_url()
        payload = json.dumps({
            "model": self.model_name(),
            "stream": False,
            "keep_alive": "15m",
            "messages": [
                {"role": "system", "content": system[:18000]},
                {"role": "user", "content": user[:5000]},
            ],
            "options": {"temperature": 0.35},
        }).encode()
        request = urllib.request.Request(
            f"{base}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=max(timeout, 150.0)) as response:
            data = json.load(response)
        text = str(data.get("message", {}).get("content", "")).strip()
        if not text:
            raise RuntimeError("Ollama retornou resposta vazia")
        self.last_transport = "http"
        return text

    def _cli_complete(self, system: str, user: str, timeout: float) -> str:
        executable = self._find_ollama()
        if not executable:
            raise RuntimeError("ollama.exe não encontrado")

        prompt = (
            f"{system[:17000]}\n\n"
            "Responda diretamente ao usuário em português do Brasil, "
            "salvo se ele escrever em inglês. Não omita a resposta.\n"
            f"Usuário: {user[:5000]}"
        )
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        completed = subprocess.run(
            [executable, "run", self.model_name(), prompt],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=max(timeout, 210.0),
            creationflags=creationflags,
        )
        answer = completed.stdout.strip()
        if completed.returncode != 0 or not answer:
            error = completed.stderr.strip() or "Ollama CLI não retornou resposta"
            raise RuntimeError(error)
        self.last_transport = "cli"
        return answer

    def complete(self, system: str, user: str, timeout: float = 150.0) -> str:
        errors: list[str] = []

        if self._server_available() or self._start_local_server():
            try:
                answer = self._http_complete(system, user, timeout)
                self.last_error = ""
                return answer
            except Exception as exc:
                errors.append(f"HTTP {exc.__class__.__name__}: {exc}")

        try:
            answer = self._cli_complete(system, user, timeout)
            self.last_error = ""
            return answer
        except Exception as exc:
            errors.append(f"CLI {exc.__class__.__name__}: {exc}")

        self.last_error = " | ".join(errors)
        raise RuntimeError(self.last_error)


class VercelProvider(ModelProvider):
    name = "vercel"

    def __init__(self) -> None:
        self.last_error = ""

    @staticmethod
    def _base_url() -> str:
        return os.getenv("DONNA_VERCEL_URL", "").rstrip("/")

    def available(self) -> bool:
        return bool(self._base_url())

    def complete(self, system: str, user: str, timeout: float = 30.0) -> str:
        base = self._base_url()
        if not base:
            raise RuntimeError("DONNA_VERCEL_URL não configurada")
        payload = json.dumps({"message": user}).encode()
        request = urllib.request.Request(
            f"{base}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=max(timeout, 45.0)) as response:
                data = json.load(response)
        except Exception as exc:
            self.last_error = f"{exc.__class__.__name__}: {exc}"
            raise
        answer = str(data.get("answer", "")).strip()
        if not answer:
            raise RuntimeError("Vercel beta retornou resposta vazia")
        self.last_error = ""
        return answer


class LocalFallbackProvider(ModelProvider):
    name = "local"

    def available(self) -> bool:
        return True

    @staticmethod
    def _tokens(text: str) -> set[str]:
        return {
            token for token in re.findall(r"[\wÀ-ÿ-]{3,}", text.lower())
            if token not in {"donna", "que", "para", "como", "uma", "uns", "das", "dos", "isso"}
        }

    def complete(self, system: str, user: str, timeout: float = 30.0) -> str:
        marker = "WEB RESEARCH:"
        research = system.split(marker, 1)[1] if marker in system else ""
        research = research.split("END WEB RESEARCH", 1)[0]

        content_lines: list[str] = []
        for raw_line in research.splitlines():
            line = raw_line.strip()
            if not line or line.startswith(("[Fonte", "Título:", "URL:")):
                continue
            if line.startswith("Conteúdo:"):
                line = line.split(":", 1)[1].strip()
            if line:
                content_lines.append(line)

        research_text = " ".join(content_lines)
        sentences = re.split(r"(?<=[.!?])\s+", research_text)
        query_tokens = self._tokens(user)
        ranked: list[tuple[int, str]] = []
        for sentence in sentences:
            clean = re.sub(r"\s+", " ", sentence).strip(" -\n")
            if len(clean) < 35:
                continue
            score = len(query_tokens & self._tokens(clean))
            if score:
                ranked.append((score, clean))
        ranked.sort(key=lambda pair: pair[0], reverse=True)
        selected = [text for _, text in ranked[:3]]
        if selected:
            return (
                "O modelo generativo local falhou, mas eu pesquisei a web e consegui recuperar isto: "
                + " ".join(selected)
            )
        return (
            "Não consegui usar o modelo generativo nem extrair uma resposta confiável da web agora. "
            "Use o Diagnóstico para ver exatamente qual camada falhou."
        )
