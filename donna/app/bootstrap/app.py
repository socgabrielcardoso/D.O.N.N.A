from __future__ import annotations

from pathlib import Path

from donna.app.config.loader import load_config, load_yaml_file
from donna.app.memory.store import MemoryStore
from donna.app.observability.logging import configure_logging
from donna.app.orchestrator.context import ContextBuilder
from donna.app.orchestrator.orchestrator import DonnaOrchestrator
from donna.app.personality.engine import PersonalityEngine
from donna.app.platform.factory import create_platform_adapter
from donna.app.providers.router import ProviderRouter
from donna.app.tools.executor import ToolExecutor
from donna.app.tools.registry import default_registry


def build_orchestrator(root: Path | None = None) -> DonnaOrchestrator:
    root = root or Path.cwd()
    config = load_config(root)
    platform = create_platform_adapter()
    tools = default_registry(platform, root)
    memory = MemoryStore(
        config.path("paths.memory_db"),
        private_mode=bool(config.get("assistant.private_mode", False)),
    )
    default = str(config.get("providers.default", "ollama"))
    fallback = list(config.get("providers.fallback", ["openai", "local"]))
    providers = ProviderRouter([default, *[x for x in fallback if x != default]])
    config_dir = Path(__file__).resolve().parents[1] / "config"
    owner_profile = load_yaml_file(config_dir / "owner_profile.yaml")
    personality_config = load_yaml_file(config_dir / "personality.yaml")
    personality = PersonalityEngine(personality_config)
    context_builder = ContextBuilder(owner_profile)
    logger = configure_logging(config.path("paths.logs_dir"), private_mode=memory.private_mode)
    return DonnaOrchestrator(
        config=config,
        tools=tools,
        memory=memory,
        personality=personality,
        providers=providers,
        context_builder=context_builder,
        executor=ToolExecutor(max_workers=2 if bool(config.get("assistant.lite_mode", False)) else 4),
        logger=logger,
    )
