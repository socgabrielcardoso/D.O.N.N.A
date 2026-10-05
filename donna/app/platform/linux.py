from __future__ import annotations

import shutil
import socket
import subprocess

from donna.app.core.models import ToolResult
from donna.app.platform.base import PlatformAdapter


class LinuxAdapter(PlatformAdapter):
    ALIASES = {
        "chrome": "google-chrome",
        "vscode": "code",
        "vs code": "code",
        "calculadora": "gnome-calculator",
    }

    def open_application(self, app: str) -> ToolResult:
        target = self.ALIASES.get(app.lower().strip(), app)
        if not shutil.which(target):
            return ToolResult(False, f"Aplicativo não encontrado: {target}")
        try:
            subprocess.Popen([target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return ToolResult(True, f"Aplicativo solicitado: {app}")
        except Exception as exc:
            return ToolResult(False, f"Não consegui abrir {app}: {exc}")

    def system_summary(self) -> ToolResult:
        import psutil

        try:
            battery_obj = psutil.sensors_battery()
            battery = getattr(battery_obj, "percent", None)
        except (FileNotFoundError, NotImplementedError, OSError):
            battery = None
        return ToolResult(
            True,
            "ok",
            {
                "cpu_percent": psutil.cpu_percent(interval=0.1),
                "memory_percent": psutil.virtual_memory().percent,
                "battery": battery,
            },
        )

    def network_status(self) -> ToolResult:
        try:
            host_ip = socket.gethostbyname(socket.gethostname())
        except OSError:
            host_ip = None
        internet = False
        try:
            with socket.create_connection(("1.1.1.1", 53), timeout=1.5):
                internet = True
        except OSError:
            pass
        return ToolResult(True, "network", {"local_ip": host_ip, "internet_reachable": internet})
