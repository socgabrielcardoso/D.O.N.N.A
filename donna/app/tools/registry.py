from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from donna.app.core.models import RiskLevel, ToolResult, ToolSpec

ToolFn = Callable[..., ToolResult]


@dataclass(slots=True)
class RegisteredTool:
    spec: ToolSpec
    handler: ToolFn


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}

    def register(self, spec: ToolSpec, handler: ToolFn) -> None:
        if spec.name in self._tools:
            raise ValueError(f"Tool already registered: {spec.name}")
        self._tools[spec.name] = RegisteredTool(spec, handler)

    def get(self, name: str) -> RegisteredTool:
        return self._tools[name]

    def names(self) -> list[str]:
        return sorted(self._tools)

    def manifest(self) -> list[dict[str, Any]]:
        return [
            {
                "name": item.spec.name,
                "description": item.spec.description,
                "risk": item.spec.risk.value,
                "confirmation": item.spec.requires_confirmation,
                "timeout_seconds": item.spec.timeout_seconds,
            }
            for item in self._tools.values()
        ]


def default_registry(platform, root: Path) -> ToolRegistry:
    import datetime as dt
    import socket

    from donna.app.vision.screen import capture_screen

    registry = ToolRegistry()
    registry.register(ToolSpec("time", "Current local time", RiskLevel.R0), lambda: ToolResult(True, dt.datetime.now().strftime("%H:%M")))
    registry.register(ToolSpec("date", "Current local date", RiskLevel.R0), lambda: ToolResult(True, dt.datetime.now().strftime("%d/%m/%Y")))
    registry.register(ToolSpec("system_information", "CPU, RAM and battery status", RiskLevel.R0), platform.system_summary)
    registry.register(ToolSpec("network_status", "Basic local connectivity diagnostics", RiskLevel.R0, timeout_seconds=4), platform.network_status)
    registry.register(ToolSpec("local_ip", "Local host IP", RiskLevel.R0), lambda: ToolResult(True, socket.gethostbyname(socket.gethostname())))
    registry.register(ToolSpec("open_application", "Open a local application", RiskLevel.R1), platform.open_application)
    registry.register(
        ToolSpec("take_screenshot", "Capture the current screen", RiskLevel.R0),
        lambda: capture_screen(root / "data" / "screenshots" / f"screen-{dt.datetime.now():%Y%m%d-%H%M%S}.png"),
    )
    return registry
