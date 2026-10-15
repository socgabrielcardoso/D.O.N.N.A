# Cloud API request boundaries — D.O.N.N.A.

**Status:** defense-in-depth proposed in a reviewable PR. These checks alone do **not** make the public cloud deployment safe for private or paid use.

## Threat model and trust boundaries

- The cloud's `/api/chat`, `/api/speech`, `/api/transcribe` and `/api/health` POST routes can incur provider/API costs. Requests are not inherently trustworthy simply because they appear to come from a browser.
- A malicious remote caller can forge an `Origin` header. Comparing it to the request URL reduces certain browser-based cross-origin interactions but **does not authenticate the owner**.
- `Content-Length` is an attacker-supplied hint and can be absent, false or larger than the actual payload. The server enforces an independent byte limit while reading the body stream.
- Provider exceptions and untrusted prompts must not be written verbatim into logs or diagnostic responses. Research results, user uploads, model replies and audio transcripts are sensitive.

## Defense-in-depth limits (this change)

| Endpoint | Accepted request | Guard | Residual risk |
| --- | --- | --- | --- |
| `POST /api/chat` | Same-origin JSON, max 48 KiB | Streaming byte limit before search/model, malformed body rejection, non-cacheable replies | **Owner authentication and durable cost quotas missing** |
| `POST /api/speech` | Same-origin JSON, max 16 KiB; text 1–3000 characters | Text type validation, no partial truncation, no-store output, generic provider error | **Owner authentication and durable cost quotas missing** |
| `POST /api/transcribe` | Same-origin multipart with boundary, max 12 MiB audio plus 64 KiB overhead | Stream read limit before form parsing; file size and MIME checks; no-store | **Owner authentication, quota and audio-content validation missing** |
| `POST /api/health` | Same-origin | Origin parsing is exception-safe and denials are no-store | **Billable probe remains unauthenticated for forged-origin callers** |
| `GET /api/research` | Printable, nonempty query up to 170 characters | Reject long/control-character queries, no-store, redacted errors | **DNS rebinding/SSRF, query abuse and rate limiting require further work** |

## Tests

`cd web-beta && npm run test:api-guards`

Regression tests cover missing, invalid and foreign origins, unsupported content types, falsified `Content-Length`, stream-overrun without relying on the header, empty bodies, malformed/non-object JSON, invalid UTF-8, multipart boundary requirements, non-cacheable outputs and bounded search queries.

The Next.js web CI runs these tests after typecheck and before build. Passing unit tests and CI checks **does not establish authorization, E2EE, or real provider inference**.

## Release blockers

1. Owner authentication and resource-level authorization across billable routes, plus durable rate/cost quotas and abuse monitoring, are necessary before public production exposure. This work is tracked in [#18](../issues/18) and [#19](../issues/19). These cannot be replaced by the `Origin` check.
2. The unauthenticated realtime token endpoint requires the fail-closed mitigation from PR #21 before release.
3. The browser memory plaintext exposure needs the opt-in/session-only mitigation in PR #22 and independent browser verification.
4. Research SSRF controls require a hardened redirect/DNS model that prevents host-to-private-IP rebinding, not just a DNS preflight.
5. Verify all relevant CI checks, the deployed preview behavior, and a **real non-greeting model response** before promoting any version. Do not infer inference from deployment READY or a health endpoint's configuration.

## Operational guidance

No changes to billing, payment instruments, account permissions or secrets are authorized by this document. If the Vercel team returns HTTP 403, do not infer preview/prod safety and do not suggest bypassing authorization. Do not include credentials or user transcripts in issues, PR discussions or CI logs.
