from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class AppState(str, Enum):
    STANDBY = "STANDBY"
    LISTENING = "LISTENING"
    THINKING = "THINKING"
    EXECUTING = "EXECUTING"
    SPEAKING = "SPEAKING"
    WAITING_CONFIRMATION = "WAITING_CONFIRMATION"
    ERROR = "ERROR"
    OFFLINE = "OFFLINE"


class RiskLevel(str, Enum):
    R0 = "R0"
    R1 = "R1"
    R2 = "R2"
    R3 = "R3"
    R4 = "R4"


@dataclass(slots=True)
class ToolResult:
    ok: bool
    message: str
    data: Any = None


@dataclass(slots=True)
class ToolSpec:
    name: str
    description: str
    risk: RiskLevel
    supported_os: tuple[str, ...] = ("windows", "linux", "darwin")
    timeout_seconds: float = 10.0
    requires_confirmation: bool = False
    permissions: tuple[str, ...] = ()


@dataclass(slots=True)
class AssistantResponse:
    text: str
    state: AppState = AppState.STANDBY
    metadata: dict[str, Any] = field(default_factory=dict)
