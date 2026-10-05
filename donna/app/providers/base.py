from __future__ import annotations

from abc import ABC, abstractmethod


class ModelProvider(ABC):
    name = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def complete(self, system: str, user: str, timeout: float = 30.0) -> str: ...
