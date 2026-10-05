# D.O.N.N.A. — Personal AI Operating Layer

**Detectar • Observar • Neutralizadora • Nobre • Astuta**

D.O.N.N.A. is a local-first personal AI operating layer for Gabriel: conversation, local tools, persistent memory, voice output, provider fallback, Windows/Linux adapters and a security gate between model intent and computer actions.

> Status: **v0.1 functional foundation / vertical slice**. The core path is real and tested. Advanced browser automation, production screen understanding, signed auto-update, bundled offline STT models and concrete cloud connectors are intentionally not advertised as finished.

## What works now

- Desktop chat UI + CLI + first-run environment check.
- `DonnaOrchestrator` routes fast local commands before asking an LLM.
- Ollama → OpenAI → offline fallback provider chain.
- No API key required to boot.
- SQLite long-term memory with stable IDs, Private Mode, forget/search behavior and secret rejection.
- Typed Tool Registry with R0–R4 risk metadata.
- Windows and Linux platform adapters.
- Local system status, time/date, local IP, application opening.
- Local TTS when `pyttsx3` is installed; SILENT mode suppresses spoken responses.
- Optional offline Vosk wake-word listener and push-to-talk STT when a local model is configured.
- Cancellation/barge-in hook stops current TTS and clears pending actions.
- Optional screen capture module.
- Prompt-injection trust boundary helpers and log secret redaction.
- Cross-platform tests and GitHub Actions CI definition.
- Windows/Linux installer launchers and PyInstaller build scripts.

## Architecture

```text
UI / CLI
   │
DonnaOrchestrator
   ├── Fast Lane (local intents)
   ├── Personality Engine
   ├── Memory Store (SQLite)
   ├── Provider Router (Ollama/OpenAI/offline)
   └── Tool Registry
          │
       Risk Engine
          │
    Platform Adapter
     Windows / Linux
```

The model does **not** receive a raw unrestricted shell primitive. Computer capabilities are explicit tools with risk metadata.

## Quick start

### Windows

1. Install Python 3.11+.
2. Clone this repository.
3. Run `installer/windows/install.ps1` once.
4. Open **D.O.N.N.A.** from the Desktop shortcut.

### Linux

```bash
chmod +x installer/linux/install.sh
./installer/linux/install.sh
```

Then open **D.O.N.N.A.** from the application menu.

### Developer mode

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux: source .venv/bin/activate
pip install -e '.[voice,vision,dev]'
python main.py
```

CLI:

```bash
python main.py --cli
```

## Providers

D.O.N.N.A. starts without a cloud credential. Default order is:

1. Ollama (`http://127.0.0.1:11434`)
2. OpenAI Responses API if `OPENAI_API_KEY` exists (default `gpt-6-luna`, configurable)
3. local offline fallback

Copy `.env.example` to `.env` only if you need cloud configuration. Never commit secrets.

## First commands

- `Donna, abra o Chrome.`
- `Donna, como está meu PC?`
- `Que horas são?`
- `Qual meu IP local?`
- `Donna, modo privado.`
- `Donna, lembre ...`
- `Donna, o que você lembra sobre mim?`
- `Donna, faça seu diagnóstico.`
- `Cancela.`

## Modes

Configuration supports `NORMAL`, `FOCUS`, `CYBER`, `WORK`, `SILENT`, `PRIVATE` and `LITE`. In v0.1 the mode is injected into personality/context; deeper per-mode tool policies remain roadmap work.

## Voice

TTS uses a local provider when available. Wake word uses a local Vosk model when configured through `DONNA_VOSK_MODEL_PATH`; no microphone audio needs to be streamed continuously to a cloud service.

A bundled Portuguese wake-word/STT model is not included because model binaries are large and have separate licensing/distribution concerns.

## Security model

- R0 read-only actions run immediately.
- R1 low/reversible actions run normally.
- R2 actions should be context-sensitive.
- R3 high-impact tools require explicit confirmation.
- R4 critical actions require reinforced confirmation or refusal.
- External content is **data, not authority**.
- Secrets are not designed to enter persistent memory or logs.
- Corporate identifiers and credentials are not hardcoded.

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Tests

```bash
pytest -q
python -m compileall -q donna main.py
```

Current local validation in the delivery environment: **20 tests passed** plus CLI and self-diagnosis smoke tests.

## Build

Windows:

```powershell
./scripts/build_windows.ps1
```

Linux:

```bash
./scripts/build_linux.sh
```

These scripts use PyInstaller. A packaged binary still needs final validation on the target Windows/Linux host before being called production-ready.

## Real limitations

Not finished yet:

- production browser agent with form/transaction verification;
- accessibility-first UI automation/OCR element map;
- Gmail/Outlook/Calendar/Drive/OneDrive/GitHub application connectors;
- system tray + global hotkey in the stdlib UI build;
- signed auto-update + rollback;
- bundled local STT model and hardware microphone validation;
- provider adapters for Gemini/Anthropic;
- fully indexed document RAG pipeline;
- Windows executable and Linux AppImage release artifacts tested on physical target machines.

Those are roadmap items, not fake buttons.

## Reference audit

The design was informed by the six supplied JARVIS archives and the supplied web references. See [docs/REFERENCE_AUDIT.md](docs/REFERENCE_AUDIT.md). No third-party code was copied verbatim into this implementation.
