from __future__ import annotations

import os
import subprocess
import threading
from typing import Any


class TTSManager:
    """Windows-first speech output with pyttsx3/SAPI and PowerShell fallback."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self._lock = threading.Lock()
        self._engine: Any | None = None
        self._pyttsx_failed = False
        self._powershell_process: subprocess.Popen[str] | None = None
        self.last_engine = "none"
        self.last_error = ""

    def _get_engine(self) -> Any | None:
        if self._pyttsx_failed:
            return None
        if self._engine is None:
            try:
                import pyttsx3

                engine = pyttsx3.init()
                engine.setProperty("rate", 185)
                voices = engine.getProperty("voices") or []
                preferred = None
                for voice in voices:
                    blob = " ".join(
                        [
                            str(getattr(voice, "name", "")),
                            str(getattr(voice, "id", "")),
                            str(getattr(voice, "languages", "")),
                        ]
                    ).lower()
                    if any(term in blob for term in ("pt-br", "portugu", "brazil")):
                        preferred = voice
                        if "female" in blob or "maria" in blob or "francisca" in blob:
                            break
                if preferred is not None:
                    engine.setProperty("voice", preferred.id)
                self._engine = engine
            except Exception as exc:
                self._pyttsx_failed = True
                self.last_error = f"pyttsx3={exc.__class__.__name__}: {exc}"
                return None
        return self._engine

    def _speak_powershell(self, text: str) -> bool:
        if os.name != "nt":
            return False

        script = (
            "Add-Type -AssemblyName System.Speech;"
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            "try{$s.SelectVoiceByHints("
            "[System.Speech.Synthesis.VoiceGender]::Female,"
            "[System.Speech.Synthesis.VoiceAge]::Adult,0,"
            "[System.Globalization.CultureInfo]::GetCultureInfo('pt-BR'))}catch{};"
            "$t=[Console]::In.ReadToEnd();"
            "if($t){$s.Speak($t)}"
        )
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            process = subprocess.Popen(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=creationflags,
            )
            self._powershell_process = process
            _, stderr = process.communicate(input=text, timeout=120)
            self._powershell_process = None
            if process.returncode == 0:
                self.last_engine = "windows-sapi"
                self.last_error = ""
                return True
            self.last_error = stderr.strip() or f"PowerShell TTS exit={process.returncode}"
        except Exception as exc:
            self._powershell_process = None
            self.last_error = f"windows-sapi={exc.__class__.__name__}: {exc}"
        return False

    def speak(self, text: str) -> bool:
        if not self.enabled or not text.strip():
            return False

        with self._lock:
            engine = self._get_engine()
            if engine is not None:
                try:
                    engine.say(text)
                    engine.runAndWait()
                    self.last_engine = "pyttsx3-sapi"
                    self.last_error = ""
                    return True
                except Exception as exc:
                    self._pyttsx_failed = True
                    self.last_error = f"pyttsx3={exc.__class__.__name__}: {exc}"

            return self._speak_powershell(text)

    def stop(self) -> None:
        process = self._powershell_process
        if process is not None and process.poll() is None:
            try:
                process.terminate()
            except Exception:
                pass
        engine = self._engine
        if engine is not None:
            try:
                engine.stop()
            except Exception:
                pass
