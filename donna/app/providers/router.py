from __future__ import annotations

from donna.app.providers.base import ModelProvider
from donna.app.providers.http import LocalFallbackProvider, OllamaProvider, OpenAIProvider


class ProviderRouter:
    def __init__(self, order: list[str] | None = None) -> None:
        self.providers: dict[str, ModelProvider] = {p.name: p for p in (OllamaProvider(), OpenAIProvider(), LocalFallbackProvider())}
        self.order = order or ["ollama", "openai", "local"]

    def complete(self, system: str, user: str, timeout: float = 30.0) -> tuple[str, str]:
        errors: list[str] = []
        for name in self.order:
            provider = self.providers.get(name)
            if not provider or not provider.available():
                continue
            try:
                return provider.complete(system, user, timeout), name
            except Exception as exc:
                errors.append(f"{name}: {exc.__class__.__name__}")
        return f"Todos os providers falharam ({', '.join(errors)}). Funções locais continuam disponíveis.", "none"
