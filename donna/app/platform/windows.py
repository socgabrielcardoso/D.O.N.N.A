from __future__ import annotations

import os
import shutil
import socket
import subprocess
from pathlib import Path
from typing import Any

from donna.app.core.models import ToolResult
from donna.app.platform.base import PlatformAdapter


class WindowsAdapter(PlatformAdapter):
    ALIASES = {
        "chrome": "chrome.exe",
        "google chrome": "chrome.exe",
        "chromwe": "chrome.exe",
        "edge": "msedge.exe",
        "microsoft edge": "msedge.exe",
        "vscode": "code.cmd",
        "vs code": "code.cmd",
        "visual studio code": "code.cmd",
        "notepad": "notepad.exe",
        "bloco de notas": "notepad.exe",
        "calculator": "calc.exe",
        "calculadora": "calc.exe",
        "defender": "windowsdefender:",
        "windows defender": "windowsdefender:",
    }

    KNOWN_PATHS = {
        "chrome.exe": (
            ("LOCALAPPDATA", r"Google\Chrome\Application\chrome.exe"),
            ("PROGRAMFILES", r"Google\Chrome\Application\chrome.exe"),
            ("PROGRAMFILES(X86)", r"Google\Chrome\Application\chrome.exe"),
        ),
        "msedge.exe": (
            ("PROGRAMFILES(X86)", r"Microsoft\Edge\Application\msedge.exe"),
            ("PROGRAMFILES", r"Microsoft\Edge\Application\msedge.exe"),
            ("LOCALAPPDATA", r"Microsoft\Edge\Application\msedge.exe"),
        ),
        "code.cmd": (
            ("LOCALAPPDATA", r"Programs\Microsoft VS Code\bin\code.cmd"),
            ("PROGRAMFILES", r"Microsoft VS Code\bin\code.cmd"),
            ("PROGRAMFILES(X86)", r"Microsoft VS Code\bin\code.cmd"),
        ),
    }

    @staticmethod
    def _registry_app_path(executable: str) -> str | None:
        if os.name != "nt":
            return None
        try:
            winreg: Any = __import__("winreg")
        except ImportError:
            return None

        key_path = rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{executable}"
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for access in (
                winreg.KEY_READ,
                winreg.KEY_READ | getattr(winreg, "KEY_WOW64_64KEY", 0),
                winreg.KEY_READ | getattr(winreg, "KEY_WOW64_32KEY", 0),
            ):
                try:
                    with winreg.OpenKey(hive, key_path, 0, access) as key:
                        value, _ = winreg.QueryValueEx(key, None)
                    if value and Path(value).exists():
                        return value
                except OSError:
                    continue
        return None

    def _resolve_executable(self, target: str) -> str | None:
        direct = Path(target)
        if direct.is_absolute() and direct.exists():
            return str(direct)

        found = shutil.which(target)
        if found:
            return found

        registry_path = self._registry_app_path(target)
        if registry_path:
            return registry_path

        for env_name, relative in self.KNOWN_PATHS.get(target.lower(), ()):
            base = os.getenv(env_name)
            if not base:
                continue
            candidate = Path(base) / relative
            if candidate.exists():
                return str(candidate)

        return None

    def open_application(self, app: str) -> ToolResult:
        clean_app = app.lower().strip().rstrip(".!?")
        target = self.ALIASES.get(clean_app, app.strip())

        try:
            starter = getattr(os, "startfile", None)

            if target.endswith(":"):
                if starter is None:
                    raise OSError("Windows startfile API unavailable")
                starter(target)
                return ToolResult(True, f"Abri {app}.")

            resolved = self._resolve_executable(target)
            if resolved:
                subprocess.Popen(
                    [resolved],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return ToolResult(True, f"Abri {app}.")

            # ShellExecute can resolve registered Windows applications even
            # when their executable is not present in PATH.
            if starter is not None:
                starter(target)
                return ToolResult(True, f"Abri {app}.")

            raise FileNotFoundError(f"Aplicativo não encontrado: {target}")
        except Exception as exc:
            return ToolResult(
                False,
                f"Não consegui abrir {app}. O aplicativo não foi localizado no Windows: {exc}",
            )

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
