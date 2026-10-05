from __future__ import annotations

import json
import os
import queue
import time
from pathlib import Path


def resolve_vosk_model_path(model_path: str | None = None) -> str | None:
    explicit = model_path or os.getenv("DONNA_VOSK_MODEL_PATH")
    if explicit and Path(explicit).exists():
        return str(Path(explicit))

    root = Path(__file__).resolve().parents[3]
    candidates = [
        root / "models" / "vosk-model-small-pt-0.3",
        Path.home() / ".donna" / "models" / "vosk-model-small-pt-0.3",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


class VoskPushToTalk:
    """Offline speech-to-text using a local Vosk model."""

    def __init__(self, model_path: str | None = None) -> None:
        self.model_path = resolve_vosk_model_path(model_path)

    def available(self) -> bool:
        return bool(self.model_path and Path(self.model_path).exists())

    def listen(self, timeout_seconds: float = 8.0) -> str:
        if not self.available():
            raise RuntimeError(
                "Modelo Vosk PT-BR não encontrado. Instale-o em "
                "models/vosk-model-small-pt-0.3 ou defina DONNA_VOSK_MODEL_PATH."
            )

        import sounddevice as sd
        from vosk import KaldiRecognizer, Model

        audio: queue.Queue[bytes] = queue.Queue()
        recognizer = KaldiRecognizer(Model(self.model_path), 16000)

        def callback(indata, frames, time_info, status):
            audio.put(bytes(indata))

        deadline = time.monotonic() + timeout_seconds
        with sd.RawInputStream(
            samplerate=16000,
            blocksize=8000,
            dtype="int16",
            channels=1,
            callback=callback,
        ):
            while time.monotonic() < deadline:
                try:
                    data = audio.get(timeout=0.5)
                except queue.Empty:
                    continue
                if recognizer.AcceptWaveform(data):
                    text = json.loads(recognizer.Result()).get("text", "").strip()
                    if text:
                        return text

        return json.loads(recognizer.FinalResult()).get("text", "").strip()
