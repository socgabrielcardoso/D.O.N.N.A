from __future__ import annotations

from donna.app.providers.base import ModelProvider
from donna.app.providers.http import LocalFallbackProvider, OllamaProvider, OpenAIProvider


class ProviderRouter:
    def __init__(self, order: list[str] | None = None) -> None:
        self.providers: dict[str, ModelProvider] = {
            p.name: p for p in (OllamaProvider(), OpenAIProvider(), LocalFallbackProvider())
        }
        self.order = order or ["ollama", "openai", "local"]
        self.last_errors: list[str] = []

    def complete(self, system: str, user: str, timeout: float = 150.0) -> tuple[str, str]:
        errors: list[str] = []
        for name in self.order:
            provider = self.providers.get(name)
            if not provider:
                continue
            try:
                if not provider.available():
                    errors.append(f"{name}: indisponível")
                    continue
            except Exception as exc:
                errors.append(f"{name}: disponibilidade {exc.__class__.__name__}")
                continue
            try:
                answer = provider.complete(system, user, timeout)
                self.last_errors = errors
                return answer, name
            except Exception as exc:
                errors.append(f"{name}: {exc.__class__.__name__}: {str(exc)[:220]}")
        self.last_errors = errors
        return (
            "Nenhum motor conseguiu responder. Diagnóstico: " + " | ".join(errors),
            "none",
        )

    def status(self) -> dict[str, object]:
        result: dict[str, object] = {}
        for name, provider in self.providers.items():
            try:
                available = provider.available()
            except Exception:
                available = False
            item: dict[str, object] = {"available": available}
            last_error = getattr(provider, "last_error", "")
            if last_error:
                item["last_error"] = last_error
            if name == "ollama":
                item["model"] = getattr(provider, "model_name")()
                item["models_installed"] = getattr(provider, "installed_models")()
                item["model_available"] = getattr(provider, "model_available")()
                item["transport"] = getattr(provider, "last_transport", "none")
            result[name] = item
        if self.last_errors:
            result["last_errors"] = list(self.last_errors)
        return result
