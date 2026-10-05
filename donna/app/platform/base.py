from __future__ import annotations

from abc import ABC, abstractmethod

from donna.app.core.models import ToolResult


class PlatformAdapter(ABC):
    @abstractmethod
    def open_application(self, app: str) -> ToolResult: ...

    @abstractmethod
    def system_summary(self) -> ToolResult: ...

    @abstractmethod
    def network_status(self) -> ToolResult: ...
