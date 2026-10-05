# Reference Audit

Six user-supplied archives were inspected as architecture references.

## OpenJarvis
**Strongest reference.** Useful patterns: provider abstraction, tool-based agents, examples, deployment layouts, CI/security workflows, clear optional extras, Windows/systemd packaging. License found: Apache-2.0.

## Jarvis-master (CLI)
Useful patterns: plugin manager, installer flow, command interpreter and test documentation. Weakness: older ecosystem assumptions and monolithic CLI-era patterns. License found: MIT.

## Microsoft JARVIS / HuggingGPT-style archive
Useful patterns: planner/tool selection concepts and model/tool orchestration. Not suitable as a desktop-assistant codebase by itself. License found: MIT.

## Small Windows JARVIS archive
Useful ideas: Vosk offline speech, local RAG experiments, UI separation and setup scripts. Weaknesses: large bundled model/binary assets, provider coupling and ad-hoc module boundaries. No top-level license was present in the supplied archive, so no source was reused.

## Small Node JARVIS archive
Useful ideas: minimal personality config, systemd launcher and browser UI. No top-level license was present in the supplied archive, so no source was reused.

## Jarvis-AI-main
Useful ideas: SQLite memory, GUI experimentation, thread separation, PyInstaller packaging and vision experiments. Major anti-patterns observed: multiple backup/fixed/unsafe variants, direct automation primitives near AI logic, provider coupling and duplicated GUI/core files. License found: MIT.

## Web references
The supplied DIO article demonstrates wake-word-style flow, Tkinter UI, speech recognition/TTS and command routing. Those ideas are useful as a beginner proof of concept, but the example also illustrates why D.O.N.N.A. separates providers, risk controls and tools instead of putting command execution directly in a large conditional chain.

The supplied commercial JARVIS page was treated only as conceptual inspiration for the product experience; marketing/branding was not copied.

## Decision
D.O.N.N.A. uses original implementation code in this repository. Third-party archives were treated as design references only, avoiding license ambiguity and inherited vulnerabilities.
