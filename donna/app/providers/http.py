from __future__ import annotations

import json
import os
import urllib.request

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

    def available(self) -> bool:
        base = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
        try:
            with urllib.request.urlopen(f"{base}/api/tags", timeout=0.35) as response:
                return 200 <= response.status < 300
        except Exception:
            return False

    def complete(self, system: str, user: str, timeout: float = 30.0) -> str:
        base = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
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
            "Estou online em modo local. Configure Ollama ou uma API para respostas generativas; "
            "as ferramentas locais continuam disponíveis."
        )
