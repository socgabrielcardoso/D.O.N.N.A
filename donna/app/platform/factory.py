from __future__ import annotations

import sys

from donna.app.platform.base import PlatformAdapter
from donna.app.platform.linux import LinuxAdapter
from donna.app.platform.windows import WindowsAdapter


def create_platform_adapter() -> PlatformAdapter:
    if sys.platform.startswith("win"):
        return WindowsAdapter()
    if sys.platform.startswith("linux"):
        return LinuxAdapter()
    raise RuntimeError(f"Unsupported platform: {sys.platform}")
