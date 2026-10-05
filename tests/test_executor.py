import time

from donna.app.core.cancellation import CancellationToken
from donna.app.core.models import RiskLevel, ToolResult, ToolSpec
from donna.app.tools.executor import ToolExecutor
from donna.app.tools.registry import RegisteredTool


def test_tool_timeout_returns_failure():
    def slow():
        time.sleep(0.1)
        return ToolResult(True, "late")

    tool = RegisteredTool(ToolSpec("slow", "slow", RiskLevel.R0, timeout_seconds=0.01), slow)
    result = ToolExecutor(max_workers=1).execute(tool, {}, CancellationToken())
    assert not result.ok
    assert "Timeout" in result.message
