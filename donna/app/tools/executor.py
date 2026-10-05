from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any

from donna.app.core.cancellation import CancellationToken
from donna.app.core.models import ToolResult
from donna.app.tools.registry import RegisteredTool


class ToolExecutor:
    def __init__(self, max_workers: int = 4) -> None:
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="donna-tool")

    def execute(self, tool: RegisteredTool, kwargs: dict[str, Any], token: CancellationToken) -> ToolResult:
        token.raise_if_cancelled()
        future = self._pool.submit(tool.handler, **kwargs)
        try:
            result = future.result(timeout=tool.spec.timeout_seconds)
        except FutureTimeout:
            future.cancel()
            return ToolResult(False, f"Timeout executando {tool.spec.name}")
        token.raise_if_cancelled()
        return result
