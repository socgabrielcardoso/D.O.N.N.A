from __future__ import annotations

import importlib.util
import platform
import sys
from pathlib import Path


def first_run_status() -> dict[str, str]:
    return {
        "OS": f"{platform.system()} {platform.release()}",
        "Python": sys.version.split()[0],
        "Desktop UI": "OK" if importlib.util.find_spec("tkinter") else "indisponível",
        "TTS local": "OK" if importlib.util.find_spec("pyttsx3") else "opcional não instalado",
        "STT local": "OK" if importlib.util.find_spec("vosk") and importlib.util.find_spec("sounddevice") else "opcional não instalado",
        "Vision": "OK" if importlib.util.find_spec("PIL") else "opcional não instalado",
        "LLM": "Ollama/OpenAI opcionais; fallback local disponível",
    }


def run_first_run_wizard(root: Path) -> None:
    marker = root / "data" / ".first_run_complete"
    if marker.exists():
        return
    import tkinter as tk
    from tkinter import ttk

    window = tk.Tk()
    window.title("D.O.N.N.A. — Primeira execução")
    window.geometry("560x420")
    window.resizable(False, False)
    frame = ttk.Frame(window, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Boa noite, Chefe.", font=("Segoe UI", 18, "bold")).pack(anchor="w")
    ttk.Label(
        frame,
        text="Sistemas principais estão prontos. Recursos opcionais aparecem abaixo e podem ser configurados depois.",
        wraplength=500,
    ).pack(anchor="w", pady=(6, 18))
    for name, status in first_run_status().items():
        row = ttk.Frame(frame)
        row.pack(fill="x", pady=3)
        ttk.Label(row, text=name, width=18).pack(side="left")
        ttk.Label(row, text=status).pack(side="left")

    def finish() -> None:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("completed\n", encoding="utf-8")
        window.destroy()

    ttk.Button(frame, text="Continuar", command=finish).pack(anchor="e", pady=(24, 0))
    window.mainloop()
