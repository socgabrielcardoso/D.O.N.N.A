from __future__ import annotations

import importlib.util
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

from donna.app.config.loader import Config
from donna.app.core.cancellation import CancellationToken, CancelledError
from donna.app.core.models import AppState, AssistantResponse
from donna.app.memory.store import MemoryItem, MemoryStore
from donna.app.orchestrator.context import ContextBuilder
from donna.app.personality.engine import PersonalityEngine
from donna.app.providers.router import ProviderRouter
from donna.app.security.risk import RiskEngine
from donna.app.tools.executor import ToolExecutor
from donna.app.tools.registry import ToolRegistry

VALID_MODES = {"NORMAL", "FOCUS", "CYBER", "WORK", "SILENT", "PRIVATE", "LITE"}


@dataclass(slots=True)
class PendingAction:
    tool_name: str
    kwargs: dict


class DonnaOrchestrator:
    def __init__(
        self,
        config: Config,
        tools: ToolRegistry,
        memory: MemoryStore,
        personality: PersonalityEngine,
        providers: ProviderRouter,
        context_builder: ContextBuilder,
        executor: ToolExecutor,
        logger: logging.Logger,
    ) -> None:
        self.config = config
        self.tools = tools
        self.memory = memory
        self.personality = personality
        self.providers = providers
        self.context_builder = context_builder
        self.executor = executor
        self.logger = logger
        self.risk = RiskEngine()
        self.pending: PendingAction | None = None
        self.token = CancellationToken()
        self.mode = str(config.get("assistant.mode", "NORMAL")).upper()

    def cancel(self) -> None:
        self.token.cancel()
        self.token = CancellationToken()
        self.pending = None
        self.logger.info("active request cancelled")

    def _response(self, text: str, state: AppState = AppState.STANDBY, **metadata) -> AssistantResponse:
        metadata.setdefault("mode", self.mode)
        metadata.setdefault("speak", self.mode != "SILENT")
        return AssistantResponse(text, state, metadata)

    def _set_mode(self, mode: str) -> AssistantResponse:
        mode = mode.upper()
        if mode not in VALID_MODES:
            return self._response(f"Modo desconhecido: {mode}.")
        self.mode = mode
        self.memory.private_mode = mode == "PRIVATE"
        self.config.set("assistant.mode", mode)
        self.config.set("assistant.private_mode", self.memory.private_mode, persist=True)
        if mode == "PRIVATE":
            return self._response("Modo privado ativo. Não vou adicionar novas memórias persistentes.")
        if mode == "SILENT":
            return self._response("Modo silencioso ativo. Respostas em texto, sem voz.")
        return self._response(f"Modo {mode} ativo.")

    def _tool_response(
        self,
        name: str,
        kwargs: dict | None = None,
        confirmed: bool = False,
        token: CancellationToken | None = None,
    ) -> AssistantResponse:
        item = self.tools.get(name)
        decision = self.risk.evaluate(item.spec, explicit_confirmation=confirmed)
        if decision.confirmation_required:
            self.pending = PendingAction(name, kwargs or {})
            return self._response(
                f"Consigo fazer, Chefe. A ação é {item.spec.risk.value} e exige confirmação explícita. Confirmar?",
                AppState.WAITING_CONFIRMATION,
                risk=item.spec.risk.value,
            )
        active_token = token or self.token
        try:
            result = self.executor.execute(item, kwargs or {}, active_token)
        except CancelledError:
            return self._response("Cancelado.")
        self.logger.info("tool=%s ok=%s", name, result.ok)
        text = result.message if result.data is None else f"{result.message}: {result.data}"
        return self._response(text, tool=name, ok=result.ok)

    def handle(self, text: str) -> AssistantResponse:
        token = self.token
        clean = text.strip()
        low = clean.lower()
        if not clean:
            return self._response("Estou ouvindo, Chefe.")
        if low in {"cancela", "cancelar", "para", "donna, para", "esquece", "chega", "para aí", "para ai"}:
            self.cancel()
            return self._response("Cancelado.")
        if self.pending and low in {"confirmo", "confirmar", "sim, confirmo", "sim senhor", "sim"}:
            pending, self.pending = self.pending, None
            return self._tool_response(pending.tool_name, pending.kwargs, confirmed=True, token=token)

        mode_match = re.search(r"(?:donna,?\s*)?(?:modo\s+)(normal|focus|cyber|work|silent|private|lite|privado|silencioso)", low)
        if mode_match:
            aliases = {"privado": "PRIVATE", "silencioso": "SILENT"}
            return self._set_mode(aliases.get(mode_match.group(1), mode_match.group(1).upper()))
        if low in {"fica quieta", "donna, fica quieta"}:
            return self._set_mode("SILENT")
        if low in {"volta", "donna, volta", "modo normal", "sair do modo privado"}:
            return self._set_mode("NORMAL")
        if "não guarde essa conversa" in low or "nao guarde essa conversa" in low:
            return self._set_mode("PRIVATE")

        if "que horas" in low or low in {"hora", "horário", "horario"}:
            return self._tool_response("time", token=token)
        if "que dia" in low or "data de hoje" in low:
            return self._tool_response("date", token=token)
        if any(x in low for x in ("como está meu pc", "como esta meu pc", "status do pc", "consumindo ram")):
            return self._tool_response("system_information", token=token)
        if any(x in low for x in ("verifica minha internet", "verifique minha internet", "status da internet", "diagnóstico de rede", "diagnostico de rede")):
            return self._tool_response("network_status", token=token)
        if "ip local" in low:
            return self._tool_response("local_ip", token=token)
        if any(x in low for x in ("tira um screenshot", "tire um screenshot", "captura a tela", "capture a tela")):
            return self._tool_response("take_screenshot", token=token)
        match = re.search(r"(?:donna,?\s*)?(?:abra|abrir)\s+(?:o\s+|meu\s+)?(.+)$", low)
        if match:
            return self._tool_response("open_application", {"app": match.group(1).strip()}, token=token)

        if low.startswith("lembre ") or low.startswith("lembre disso"):
            payload = clean.split(" ", 1)[1] if " " in clean else clean
            key = self.memory.stable_key(payload)
            ok = self.memory.remember(MemoryItem(key, payload, "owner_note"))
            return self._response(
                f"Memória salva com ID {key}." if ok else "Não salvei: modo privado ou conteúdo sensível detectado."
            )
        if low.startswith("esqueça ") or low.startswith("esqueca "):
            query = clean.split(" ", 1)[1].strip()
            removed = self.memory.forget(query) or self.memory.forget_matching(query) > 0
            return self._response("Removido." if removed else "Não encontrei essa memória.")
        if "o que você lembra" in low or "o que voce lembra" in low:
            items = self.memory.all()
            if not items:
                return self._response("Nada persistente ainda, Chefe.")
            return self._response("Memória persistente: " + "; ".join(f"{item.key}={item.value}" for item in items[:10]))
        if "faça seu diagnóstico" in low or "faca seu diagnostico" in low or low == "diagnóstico" or low == "diagnostico":
            return self.health_check()

        live_context = self.context_builder.build(clean, self.mode)
        system = self.personality.system_context(live_context)
        try:
            answer, provider = self.providers.complete(system, clean, float(self.config.get("providers.timeout_seconds", 30)))
            token.raise_if_cancelled()
        except CancelledError:
            return self._response("Cancelado.")
        self.logger.info("provider=%s", provider)
        return self._response(answer, provider=provider)

    def health_check(self) -> AssistantResponse:
        provider_status = {name: provider.available() for name, provider in self.providers.providers.items()}
        memory_ok = False
        try:
            self.memory.path.parent.mkdir(parents=True, exist_ok=True)
            memory_ok = os.access(self.memory.path.parent, os.W_OK)
        except OSError:
            pass
        wake_path = os.getenv("DONNA_VOSK_MODEL_PATH")
        health = {
            "mode": self.mode,
            "memory_writable": memory_ok,
            "memory_path": str(self.memory.path),
            "private_mode": self.memory.private_mode,
            "tools": self.tools.names(),
            "providers": provider_status,
            "voice_local_available": importlib.util.find_spec("pyttsx3") is not None,
            "wake_word_model_configured": bool(wake_path and Path(wake_path).exists()),
            "screen_capture_dependency": importlib.util.find_spec("PIL") is not None,
        }
        ok = memory_ok and bool(self.tools.names())
        return self._response(
            f"Diagnóstico {'OK' if ok else 'com alertas'}: {health}",
            health=health,
            ok=ok,
        )
