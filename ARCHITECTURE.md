# Architecture

D.O.N.N.A. follows **Perceive → Understand → Analyze → Plan → Validate Risk → Execute → Verify → Respond → Learn**.

## Layers
- **Brain:** `DonnaOrchestrator`, `ContextBuilder`, provider router, personality/context composition.
- **Memory:** SQLite-backed persistent memory with private mode and secret rejection.
- **Senses:** voice/wake-word and screen capture adapters are optional.
- **Hands:** typed Tool Registry + timeout-aware ToolExecutor behind the Risk Engine.
- **Immune system:** risk classification, confirmation gates, prompt-injection boundary, secret redaction.
- **Body:** Windows/Linux `PlatformAdapter` implementations.
- **Face:** Tk desktop UI with background work and cancellation.

## Design rule
The model never receives a raw shell primitive. Capabilities are exposed as explicit tools with risk metadata. High-impact operations must be implemented as tools and pass the same gate.
