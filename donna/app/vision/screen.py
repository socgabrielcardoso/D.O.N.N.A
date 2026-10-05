from __future__ import annotations

from pathlib import Path

from donna.app.core.models import ToolResult


def capture_screen(path: Path) -> ToolResult:
    try:
        from PIL import ImageGrab
        path.parent.mkdir(parents=True, exist_ok=True)
        ImageGrab.grab().save(path)
        return ToolResult(True, f"Screenshot salvo em {path}", str(path))
    except Exception as exc:
        return ToolResult(False, f"Captura indisponível: {exc}")
