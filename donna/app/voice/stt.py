from __future__ import annotations

import json
import os
import queue
import time
from pathlib import Path


class VoskPushToTalk:
    """Offline speech-to-text. Requires vosk, sounddevice and a local model path."""

    def __init__(self, model_path: str | None = None) -> None:
        self.model_path = model_path or os.getenv("DONNA_VOSK_MODEL_PATH")

    def available(self) -> bool:
        return bool(self.model_path and Path(self.model_path).exists())

    def listen(self, timeout_seconds: float = 8.0) -> str:
        if not self.available():
            raise RuntimeError("Modelo Vosk não configurado. Defina DONNA_VOSK_MODEL_PATH.")
        import sounddevice as sd
        from vosk import KaldiRecognizer, Model

        audio: queue.Queue[bytes] = queue.Queue()
        recognizer = KaldiRecognizer(Model(self.model_path), 16000)

        def callback(indata, frames, time_info, status):
            audio.put(bytes(indata))

        deadline = time.monotonic() + timeout_seconds
        with sd.RawInputStream(samplerate=16000, blocksize=8000, dtype="int16", channels=1, callback=callback):
            while time.monotonic() < deadline:
                try:
                    data = audio.get(timeout=0.5)
                except queue.Empty:
                    continue
                if recognizer.AcceptWaveform(data):
                    text = json.loads(recognizer.Result()).get("text", "").strip()
                    if text:
                        return text
        final_text = json.loads(recognizer.FinalResult()).get("text", "").strip()
        return final_text
