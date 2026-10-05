from __future__ import annotations

import threading


class TTSManager:
    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self._lock = threading.Lock()
        self._engine = None

    def _get_engine(self):
        if self._engine is None:
            try:
                import pyttsx3
                self._engine = pyttsx3.init()
            except Exception:
                self._engine = False
        return self._engine

    def speak(self, text: str) -> bool:
        if not self.enabled:
            return False
        engine = self._get_engine()
        if not engine:
            return False
        with self._lock:
            engine.say(text)
            engine.runAndWait()
        return True

    def stop(self) -> None:
        engine = self._get_engine()
        if engine:
            try:
                engine.stop()
            except Exception:
                pass
