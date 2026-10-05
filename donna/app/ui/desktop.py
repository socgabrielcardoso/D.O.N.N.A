from __future__ import annotations

import queue
import threading
import tkinter as tk
from typing import cast
from tkinter import ttk

from donna.app.core.models import AppState, AssistantResponse
from donna.app.orchestrator.orchestrator import DonnaOrchestrator
from donna.app.voice.stt import VoskPushToTalk
from donna.app.voice.tts import TTSManager
from donna.app.voice.wake import VoskWakeWordListener


class DonnaDesktop:
    def __init__(self, orchestrator: DonnaOrchestrator) -> None:
        self.orchestrator = orchestrator
        self.tts = TTSManager(enabled=bool(orchestrator.config.get("voice.enabled", True)))
        self.stt = VoskPushToTalk()
        self.wake: VoskWakeWordListener | None = None
        self.root = tk.Tk()
        self.root.title("D.O.N.N.A. — Personal AI Operating Layer")
        self.root.geometry("940x640")
        self.root.minsize(760, 500)
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.events: queue.Queue[tuple[str, AssistantResponse | str | BaseException | None]] = queue.Queue()
        self._build()
        self._start_wake_word_if_enabled()
        self.root.after(80, self._poll)

    def _build(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)
        header = ttk.Frame(self.root, padding=12)
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(1, weight=1)
        ttk.Label(header, text="D.O.N.N.A.", font=("Segoe UI", 20, "bold")).grid(row=0, column=0, sticky="w")
        self.state = tk.StringVar(value=AppState.STANDBY.value)
        ttk.Label(header, textvariable=self.state).grid(row=0, column=1, sticky="e")
        self.mode = tk.StringVar(value=self.orchestrator.mode)
        ttk.Label(header, textvariable=self.mode).grid(row=0, column=2, padx=(16, 0))
        self.private = tk.BooleanVar(value=self.orchestrator.memory.private_mode)
        ttk.Checkbutton(header, text="Private Mode", variable=self.private, command=self._toggle_private).grid(row=0, column=3, padx=(16, 0))

        self.chat = tk.Text(self.root, wrap="word", state="disabled", padx=14, pady=14, font=("Segoe UI", 11))
        self.chat.grid(row=1, column=0, sticky="nsew", padx=12)

        bottom = ttk.Frame(self.root, padding=12)
        bottom.grid(row=2, column=0, sticky="ew")
        bottom.columnconfigure(0, weight=1)
        self.entry = ttk.Entry(bottom)
        self.entry.grid(row=0, column=0, sticky="ew")
        self.entry.bind("<Return>", lambda _: self.send())
        ttk.Button(bottom, text="Enviar", command=self.send).grid(row=0, column=1, padx=(8, 0))
        ttk.Button(bottom, text="Ouvir", command=self.listen).grid(row=0, column=2, padx=(8, 0))
        ttk.Button(bottom, text="Cancelar", command=self.cancel).grid(row=0, column=3, padx=(8, 0))
        ttk.Button(bottom, text="Diagnóstico", command=lambda: self._submit("Donna, faça seu diagnóstico")).grid(row=0, column=4, padx=(8, 0))
        self._append("D.O.N.N.A.", "Sistemas online. Boa noite, Chefe.")
        self.entry.focus_set()

    def _start_wake_word_if_enabled(self) -> None:
        if not bool(self.orchestrator.config.get("features.wake_word", False)):
            return
        aliases = list(self.orchestrator.config.get("voice.aliases", ["Donna"]))
        listener = VoskWakeWordListener(aliases, lambda: self.events.put(("wake", None)))
        if not listener.available():
            self._append("Sistema", "Wake word habilitado, mas o modelo Vosk local não está configurado.")
            return
        self.wake = listener
        threading.Thread(target=self._wake_worker, daemon=True).start()

    def _wake_worker(self) -> None:
        try:
            assert self.wake is not None
            self.wake.run()
        except Exception as exc:
            self.events.put(("wake_error", exc))

    def _toggle_private(self) -> None:
        target = "modo private" if self.private.get() else "modo normal"
        response = self.orchestrator.handle(target)
        self.mode.set(self.orchestrator.mode)
        self._append("Sistema", response.text)

    def _append(self, who: str, text: str) -> None:
        self.chat.configure(state="normal")
        self.chat.insert("end", f"{who}: {text}\n\n")
        self.chat.see("end")
        self.chat.configure(state="disabled")

    def send(self) -> None:
        text = self.entry.get().strip()
        if not text:
            return
        self.entry.delete(0, "end")
        self._append("Gabriel", text)
        self._submit(text)

    def listen(self) -> None:
        if not self.stt.available():
            self._append("Sistema", "STT local indisponível. Configure DONNA_VOSK_MODEL_PATH para usar o botão Ouvir.")
            return
        self.state.set(AppState.LISTENING.value)
        threading.Thread(target=self._listen_worker, daemon=True).start()

    def _listen_worker(self) -> None:
        try:
            text = self.stt.listen()
            self.events.put(("speech", text))
        except Exception as exc:
            self.events.put(("error", exc))

    def _submit(self, text: str) -> None:
        self.state.set(AppState.THINKING.value)
        threading.Thread(target=self._worker, args=(text,), daemon=True).start()

    def _worker(self, text: str) -> None:
        try:
            response = self.orchestrator.handle(text)
            self.events.put(("response", response))
        except Exception as exc:
            self.events.put(("error", exc))

    def _poll(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "response":
                    response = cast(AssistantResponse, payload)
                    self.mode.set(self.orchestrator.mode)
                    self.private.set(self.orchestrator.memory.private_mode)
                    self.state.set(response.state.value)
                    self._append("D.O.N.N.A.", response.text)
                    if response.metadata.get("speak", True):
                        threading.Thread(target=self.tts.speak, args=(response.text,), daemon=True).start()
                    if response.state != AppState.WAITING_CONFIRMATION:
                        self.state.set(AppState.STANDBY.value)
                elif kind == "speech":
                    text = str(payload).strip()
                    if text:
                        self._append("Gabriel", text)
                        self._submit(text)
                    else:
                        self.state.set(AppState.STANDBY.value)
                        self._append("Sistema", "Não entendi a fala.")
                elif kind == "wake":
                    self.root.deiconify()
                    self.root.lift()
                    self.entry.focus_set()
                    self.state.set(AppState.LISTENING.value)
                    self._append("Sistema", "Wake word detectado.")
                elif kind == "wake_error":
                    self._append("Sistema", f"Wake word indisponível: {payload}")
                else:
                    self.state.set(AppState.ERROR.value)
                    self._append("Erro", str(payload))
        except queue.Empty:
            pass
        self.root.after(80, self._poll)

    def cancel(self) -> None:
        self.orchestrator.cancel()
        self.tts.stop()
        self.state.set(AppState.STANDBY.value)
        self._append("D.O.N.N.A.", "Cancelado.")

    def _close(self) -> None:
        if self.wake:
            self.wake.stop()
        self.tts.stop()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()
