import logging
from pathlib import Path

from donna.app.config.loader import Config
from donna.app.core.models import RiskLevel, ToolResult, ToolSpec
from donna.app.memory.store import MemoryStore
from donna.app.orchestrator.context import ContextBuilder
from donna.app.orchestrator.orchestrator import DonnaOrchestrator
from donna.app.personality.engine import PersonalityEngine
from donna.app.providers.base import ModelProvider
from donna.app.providers.router import ProviderRouter
from donna.app.tools.executor import ToolExecutor
from donna.app.tools.registry import ToolRegistry


class FakeProvider(ModelProvider):
    name = "fake"

    def available(self):
        return True

    def complete(self, system, user, timeout=30):
        return f"AI:{user}"


def make_orchestrator(tmp_path: Path):
    cfg = Config({"assistant": {"mode": "NORMAL"}, "providers": {"timeout_seconds": 1}}, tmp_path)
    tools = ToolRegistry()
    tools.register(ToolSpec("time", "time", RiskLevel.R0), lambda: ToolResult(True, "12:34"))
    tools.register(ToolSpec("date", "date", RiskLevel.R0), lambda: ToolResult(True, "04/10/2026"))
    tools.register(
        ToolSpec("system_information", "sys", RiskLevel.R0),
        lambda: ToolResult(True, "ok", {"memory_percent": 42}),
    )
    tools.register(ToolSpec("network_status", "net", RiskLevel.R0), lambda: ToolResult(True, "network", {"internet_reachable": True}))
    tools.register(ToolSpec("local_ip", "ip", RiskLevel.R0), lambda: ToolResult(True, "192.168.0.2"))
    tools.register(ToolSpec("take_screenshot", "shot", RiskLevel.R0), lambda: ToolResult(True, "saved"))
    tools.register(ToolSpec("open_application", "open", RiskLevel.R1), lambda app: ToolResult(True, f"opened {app}"))
    providers = ProviderRouter(["local"])
    providers.providers["local"] = FakeProvider()
    logger = logging.getLogger(f"test-{tmp_path.name}")
    logger.addHandler(logging.NullHandler())
    return DonnaOrchestrator(
        cfg,
        tools,
        MemoryStore(tmp_path / "m.db"),
        PersonalityEngine({"principles": ["direct"]}),
        providers,
        ContextBuilder({"owner": {"name": "Gabriel"}}),
        ToolExecutor(),
        logger,
    )


def test_fast_lane_time(tmp_path):
    orchestrator = make_orchestrator(tmp_path)
    assert orchestrator.handle("que horas são?").text == "12:34"


def test_open_app_tool(tmp_path):
    orchestrator = make_orchestrator(tmp_path)
    response = orchestrator.handle("Donna, abra o chrome")
    assert "opened chrome" in response.text


def test_network_tool(tmp_path):
    orchestrator = make_orchestrator(tmp_path)
    response = orchestrator.handle("verifica minha internet")
    assert "internet_reachable" in response.text


def test_falls_back_to_model(tmp_path):
    orchestrator = make_orchestrator(tmp_path)
    assert orchestrator.handle("explique zero trust").text == "AI:explique zero trust"


def test_cancel_command(tmp_path):
    orchestrator = make_orchestrator(tmp_path)
    assert orchestrator.handle("cancela").text == "Cancelado."


def test_mode_change_persists(tmp_path):
    orchestrator = make_orchestrator(tmp_path)
    response = orchestrator.handle("modo cyber")
    assert orchestrator.mode == "CYBER"
    assert "CYBER" in response.text
    assert (tmp_path / "user.yaml").exists()


def test_private_mode_blocks_memory(tmp_path):
    orchestrator = make_orchestrator(tmp_path)
    orchestrator.handle("modo private")
    response = orchestrator.handle("lembre isso teste importante")
    assert "Não salvei" in response.text
