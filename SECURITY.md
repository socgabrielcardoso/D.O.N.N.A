# Security

## Trust model
External webpages, mail, documents, PDFs, images, code and tool output are untrusted data. They cannot override owner intent, permissions or the Risk Engine.

## Risk levels
- R0: read-only
- R1: low/reversible
- R2: sensitive/context dependent
- R3: high impact, always confirm
- R4: critical, reinforced confirmation or refusal

## Secrets
Do not commit `.env`, tokens, cookies, passwords or recovery keys. Persistent memory rejects common secret markers and logs are designed to pass through redaction before persistence.

## Reporting
Use GitHub private security reporting if enabled; otherwise open a minimal issue without secrets and request a private channel.
