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
from donna.app.memory.store import ConversationTurn, MemoryItem, MemoryStore
from donna.app.orchestrator.context import ContextBuilder
from donna.app.personality.engine import PersonalityEngine
from donna.app.providers.router import ProviderRouter
from donna.app.research.web import ResearchResult, WebResearchService
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
        research: WebResearchService | None = None,
    ) -> None:
        self.config = config
        self.tools = tools
        self.memory = memory
        self.personality = personality
        self.providers = providers
        self.context_builder = context_builder
        self.executor = executor
        self.logger = logger
        self.research = research or WebResearchService(
            timeout_seconds=float(config.get("research.timeout_seconds", 8))
        )
        self.risk = RiskEngine()
        self.pending: PendingAction | None = None
        self.token = CancellationToken()
        self.mode = str(config.get("assistant.mode", "NORMAL")).upper()

    def cancel(self) -> None:
        self.token.cancel()
        self.token = CancellationToken()
        self.pending = None
        self.logger.info("active request cancelled")

    def _response(
        self,
        text: str,
        state: AppState = AppState.STANDBY,
        **metadata,
    ) -> AssistantResponse:
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
            return self._response(
                "Modo privado ativo. Não vou adicionar novas memórias persistentes."
            )
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
                f"Consigo fazer, Chefe. A ação é {item.spec.risk.value} e exige "
                "confirmação explícita. Confirmar?",
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

    def _research_context(self, query: str) -> tuple[list[ResearchResult], str]:
        enabled = bool(self.config.get("features.web_research", False))
        if not enabled:
            return [], "Pesquisa web desabilitada."

        try:
            results = self.research.search(
                query,
                max_results=int(self.config.get("research.max_results", 4)),
                fetch_pages=int(self.config.get("research.fetch_pages", 2)),
            )
        except Exception as exc:
            self.logger.warning("web research failed: %s", exc)
            return [], f"Pesquisa web falhou: {exc.__class__.__name__}"

        return results, self.research.prompt_context(results)

    def _build_generation_system(
        self,
        user_text: str,
        research_context: str,
        memory_context: str,
    ) -> str:
        live_context = self.context_builder.build(user_text, self.mode)
        base = self.personality.system_context(live_context)
        return (
            f"{base}\n\n"
            "MEMÓRIA RELEVANTE:\n"
            f"{memory_context or 'Nenhuma memória relevante recuperada.'}\n"
            "END MEMORY\n\n"
            "WEB RESEARCH:\n"
            f"{research_context}\n"
            "END WEB RESEARCH\n\n"
            "Regras desta resposta:\n"
            "- Responda sempre à pergunta do usuário; não responda apenas com diagnóstico técnico.\n"
            "- Use a pesquisa web quando ela trouxer fatos úteis ou atuais.\n"
            "- Diferencie fatos recuperados, inferências e incertezas.\n"
            "- Nunca invente que pesquisou uma fonte que não aparece no contexto.\n"
            "- Use a memória somente quando ela for relevante à pergunta.\n"
            "- Seja direta, clara e útil.\n"
        )

    def _persist_turn(self, user_text: str, response: str, provider: str) -> None:
        try:
            self.memory.remember_turn(
                ConversationTurn(
                    user_text=user_text,
                    assistant_text=response,
                    provider=provider,
                )
            )
        except Exception as exc:
            self.logger.warning("conversation memory write failed: %s", exc)

    def handle(self, text: str) -> AssistantResponse:
        token = self.token
        clean = text.strip()
        low = clean.lower()

        if not clean:
            return self._response("Estou ouvindo, Chefe.")

        if low in {
            "cancela", "cancelar", "para", "donna, para", "esquece",
            "chega", "para aí", "para ai",
        }:
            self.cancel()
            return self._response("Cancelado.")

        if self.pending and low in {
            "confirmo", "confirmar", "sim, confirmo", "sim senhor", "sim",
        }:
            pending, self.pending = self.pending, None
            return self._tool_response(
                pending.tool_name,
                pending.kwargs,
                confirmed=True,
                token=token,
            )

        mode_match = re.search(
            r"(?:donna,?\s*)?(?:modo\s+)"
            r"(normal|focus|cyber|work|silent|private|lite|privado|silencioso)",
            low,
        )
        if mode_match:
            aliases = {"privado": "PRIVATE", "silencioso": "SILENT"}
            return self._set_mode(
                aliases.get(mode_match.group(1), mode_match.group(1).upper())
            )

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
        if any(
            item in low
            for item in ("como está meu pc", "como esta meu pc", "status do pc", "consumindo ram")
        ):
            return self._tool_response("system_information", token=token)
        if any(
            item in low
            for item in (
                "verifica minha internet",
                "verifique minha internet",
                "status da internet",
                "diagnóstico de rede",
                "diagnostico de rede",
            )
        ):
            return self._tool_response("network_status", token=token)
        if "ip local" in low:
            return self._tool_response("local_ip", token=token)
        if any(
            item in low
            for item in (
                "tira um screenshot",
                "tire um screenshot",
                "captura a tela",
                "capture a tela",
            )
        ):
            return self._tool_response("take_screenshot", token=token)

        match = re.search(
            r"(?:donna,?\s*)?(?:abra|abre|abrir)\s+(?:o\s+|meu\s+)?(.+)$",
            low,
        )
        if match:
            return self._tool_response(
                "open_application",
                {"app": match.group(1).strip()},
                token=token,
            )

        if low.startswith("lembre ") or low.startswith("lembre disso"):
            payload = clean.split(" ", 1)[1] if " " in clean else clean
            key = self.memory.stable_key(payload)
            ok = self.memory.remember(MemoryItem(key, payload, "owner_note"))
            return self._response(
                f"Memória salva com ID {key}."
                if ok
                else "Não salvei: modo privado ou conteúdo sensível detectado."
            )

        if low.startswith("esqueça ") or low.startswith("esqueca "):
            query = clean.split(" ", 1)[1].strip()
            removed = self.memory.forget(query) or self.memory.forget_matching(query) > 0
            return self._response("Removido." if removed else "Não encontrei essa memória.")

        if "o que você lembra" in low or "o que voce lembra" in low:
            items = self.memory.all()
            stats = self.memory.stats()
            if not items and not stats["conversation_turns"]:
                return self._response("Nada persistente ainda, Chefe.")
            explicit = "; ".join(
                f"{item.key}={item.value}" for item in items[:10]
            )
            summary = (
                f"Tenho {stats['conversation_turns']} turnos de conversa persistidos"
                f" e {stats['memories']} memórias explícitas."
            )
            return self._response(
                summary + (f" Memórias: {explicit}" if explicit else "")
            )

        if (
            "faça seu diagnóstico" in low
            or "faca seu diagnostico" in low
            or low == "diagnóstico"
            or low == "diagnostico"
        ):
            return self.health_check()

        self.logger.info("generation pipeline start")

        memory_context = self.memory.relevant_context(clean)
        research_results, research_context = self._research_context(clean)
        token.raise_if_cancelled()

        system = self._build_generation_system(
            clean,
            research_context,
            memory_context,
        )

        try:
            timeout = max(
                120.0,
                float(self.config.get("providers.timeout_seconds", 150)),
            )
            answer, provider = self.providers.complete(system, clean, timeout)
            token.raise_if_cancelled()
        except CancelledError:
            return self._response("Cancelado.")

        show_sources = bool(self.config.get("research.show_sources", True))
        if research_results and show_sources:
            footer = self.research.source_footer(research_results)
            if footer:
                answer = f"{answer}\n\n{footer}"

        self.logger.info(
            "provider=%s research_sources=%s memory_context=%s",
            provider,
            len(research_results),
            bool(memory_context),
        )
        self._persist_turn(clean, answer, provider)

        return self._response(
            answer,
            provider=provider,
            sources=[{"title": item.title, "url": item.url} for item in research_results],
            memory_used=bool(memory_context),
            researched=bool(research_results),
        )

    def health_check(self) -> AssistantResponse:
        try:
            provider_status = self.providers.status()
        except Exception as exc:
            provider_status = {"error": f"{exc.__class__.__name__}: {exc}"}

        try:
            memory_stats = self.memory.stats()
            memory_ok = os.access(self.memory.path.parent, os.W_OK)
        except Exception:
            memory_stats = {"memories": 0, "conversation_turns": 0}
            memory_ok = False

        try:
            web_ok = self.research.available()
        except Exception:
            web_ok = False

        wake_path = os.getenv("DONNA_VOSK_MODEL_PATH")
        if not wake_path:
            auto_path = (
                Path(__file__).resolve().parents[3]
                / "models"
                / "vosk-model-small-pt-0.3"
            )
            wake_path = str(auto_path) if auto_path.exists() else ""

        pyttsx_ok = importlib.util.find_spec("pyttsx3") is not None
        speech_recognition_ok = importlib.util.find_spec("speech_recognition") is not None
        sounddevice_ok = importlib.util.find_spec("sounddevice") is not None
        vosk_ok = importlib.util.find_spec("vosk") is not None
        vosk_model_ok = bool(wake_path and Path(wake_path).exists())

        health = {
            "platform": "windows-first",
            "mode": self.mode,
            "memory": {
                "writable": memory_ok,
                "path": str(self.memory.path),
                **memory_stats,
            },
            "web_research": web_ok,
            "providers": provider_status,
            "tools": self.tools.names(),
            "voice": {
                "pyttsx3": pyttsx_ok,
                "speech_recognition": speech_recognition_ok,
                "sounddevice": sounddevice_ok,
                "vosk": vosk_ok,
                "vosk_model": vosk_model_ok,
            },
            "vision": importlib.util.find_spec("PIL") is not None,
        }

        ollama_info = provider_status.get("ollama", {})
        ollama_ok = bool(
            isinstance(ollama_info, dict)
            and ollama_info.get("available")
            and ollama_info.get("model_available")
        )
        ok = memory_ok and bool(self.tools.names()) and ollama_ok

        status = "OK" if ok else "COM ALERTAS"
        text = (
            f"Diagnóstico {status}. "
            f"Ollama={'OK' if ollama_ok else 'FALHA'}; "
            f"Web={'OK' if web_ok else 'FALHA'}; "
            f"Memória={'OK' if memory_ok else 'FALHA'}; "
            f"STT={'OK' if sounddevice_ok else 'FALHA'}; "
            f"TTS={'OK' if pyttsx_ok or os.name == 'nt' else 'FALHA'}."
        )
        if not ollama_ok:
            text += f" Providers: {provider_status}"

        return self._response(text, health=health, ok=ok)
