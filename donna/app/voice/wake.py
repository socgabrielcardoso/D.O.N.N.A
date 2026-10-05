from __future__ import annotations

import json
import queue
from pathlib import Path
from typing import Callable

from donna.app.voice.stt import resolve_vosk_model_path


class VoskWakeWordListener:
    """Offline wake-word listener using the same local Vosk model as STT."""

    def __init__(
        self,
        wake_words: list[str],
        on_wake: Callable[[], None],
        model_path: str | None = None,
    ) -> None:
        self.wake_words = [w.lower() for w in wake_words]
        self.on_wake = on_wake
        self.model_path = resolve_vosk_model_path(model_path)
        self._stop = False

    def available(self) -> bool:
        return bool(self.model_path and Path(self.model_path).exists())

    def run(self) -> None:
        if not self.available():
            raise RuntimeError("Vosk model not configured")

        import sounddevice as sd
        from vosk import KaldiRecognizer, Model

        audio: queue.Queue[bytes] = queue.Queue()
        recognizer = KaldiRecognizer(Model(self.model_path), 16000)

        def callback(indata, frames, time_info, status):
            if not self._stop:
                audio.put(bytes(indata))

        with sd.RawInputStream(
            samplerate=16000,
            blocksize=8000,
            dtype="int16",
            channels=1,
            callback=callback,
        ):
            while not self._stop:
                try:
                    data = audio.get(timeout=0.5)
                except queue.Empty:
                    continue
                if recognizer.AcceptWaveform(data):
                    text = json.loads(recognizer.Result()).get("text", "").lower()
                    if any(word in text for word in self.wake_words):
                        self.on_wake()

    def stop(self) -> None:
        self._stop = True
