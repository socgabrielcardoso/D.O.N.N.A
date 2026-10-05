from __future__ import annotations

import json
import math
import os
import queue
import time
from array import array
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


class HybridSpeechToText:
    """Windows-focused STT: online recognizer first, offline Vosk fallback."""

    def __init__(self, model_path: str | None = None, language: str = "pt-BR") -> None:
        self.model_path = resolve_vosk_model_path(model_path)
        self.language = language
        self.last_engine = "none"
        self.last_error = ""

    def available(self) -> bool:
        try:
            import sounddevice  # noqa: F401
            return True
        except Exception:
            return False

    @staticmethod
    def _rms(data: bytes) -> float:
        if not data:
            return 0.0
        samples = array("h")
        samples.frombytes(data)
        if not samples:
            return 0.0
        return math.sqrt(sum(sample * sample for sample in samples) / len(samples))

    def _capture(
        self,
        timeout_seconds: float = 9.0,
        speech_timeout: float = 3.0,
        silence_seconds: float = 0.9,
    ) -> bytes:
        import sounddevice as sd

        audio: queue.Queue[bytes] = queue.Queue()
        chunks: list[bytes] = []
        started = False
        start_time = time.monotonic()
        last_voice = start_time
        noise_floor = 250.0

        def callback(indata, frames, time_info, status):
            audio.put(bytes(indata))

        with sd.RawInputStream(
            samplerate=16000,
            blocksize=1600,
            dtype="int16",
            channels=1,
            callback=callback,
        ):
            while time.monotonic() - start_time < timeout_seconds:
                try:
                    data = audio.get(timeout=0.25)
                except queue.Empty:
                    continue

                level = self._rms(data)
                if not started:
                    noise_floor = max(120.0, min(noise_floor * 0.9 + level * 0.1, 1500.0))
                    threshold = max(450.0, noise_floor * 2.2)
                    if level >= threshold:
                        started = True
                        last_voice = time.monotonic()
                        chunks.append(data)
                    elif time.monotonic() - start_time >= speech_timeout:
                        break
                else:
                    chunks.append(data)
                    threshold = max(350.0, noise_floor * 1.7)
                    if level >= threshold:
                        last_voice = time.monotonic()
                    elif time.monotonic() - last_voice >= silence_seconds:
                        break

        return b"".join(chunks)

    def _recognize_online(self, pcm: bytes) -> str:
        import speech_recognition as sr

        recognizer = sr.Recognizer()
        audio_data = sr.AudioData(pcm, 16000, 2)
        return str(recognizer.recognize_google(audio_data, language=self.language)).strip()

    def _recognize_vosk(self, pcm: bytes) -> str:
        if not self.model_path or not Path(self.model_path).exists():
            return ""

        from vosk import KaldiRecognizer, Model

        recognizer = KaldiRecognizer(Model(self.model_path), 16000)
        recognizer.AcceptWaveform(pcm)
        result = json.loads(recognizer.FinalResult())
        return str(result.get("text", "")).strip()

    def listen(self, timeout_seconds: float = 9.0) -> str:
        if not self.available():
            raise RuntimeError("Microfone/STT indisponível: sounddevice não está acessível.")

        pcm = self._capture(timeout_seconds=timeout_seconds)
        if not pcm:
            self.last_engine = "none"
            self.last_error = "Nenhuma fala detectada."
            return ""

        online_error = ""
        try:
            text = self._recognize_online(pcm)
            if text:
                self.last_engine = "google-web"
                self.last_error = ""
                return text
        except Exception as exc:
            online_error = f"{exc.__class__.__name__}: {exc}"

        try:
            text = self._recognize_vosk(pcm)
            if text:
                self.last_engine = "vosk"
                self.last_error = online_error
                return text
        except Exception as exc:
            self.last_error = (
                f"online={online_error or 'sem resultado'}; "
                f"vosk={exc.__class__.__name__}: {exc}"
            )
            return ""

        self.last_engine = "none"
        self.last_error = online_error or "Nenhum reconhecedor produziu texto."
        return ""


# Backward-compatible alias used by older UI/tests.
VoskPushToTalk = HybridSpeechToText
