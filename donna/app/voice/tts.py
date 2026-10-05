from __future__ import annotations

import threading
from typing import Any


class TTSManager:
    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self._lock = threading.Lock()
        self._engine: Any | None = None
        self._failed = False

    def _get_engine(self) -> Any | None:
        if self._failed:
            return None
        if self._engine is None:
            try:
                import pyttsx3

                self._engine = pyttsx3.init()
            except Exception:
                self._failed = True
                return None
        return self._engine

    def speak(self, text: str) -> bool:
        if not self.enabled:
            return False
        engine = self._get_engine()
        if engine is None:
            return False
        with self._lock:
            engine.say(text)
            engine.runAndWait()
        return True

    def stop(self) -> None:
        engine = self._get_engine()
        if engine is not None:
            try:
                engine.stop()
            except Exception:
                pass
