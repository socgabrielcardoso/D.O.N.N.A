# Cloud AI diagnostic runbook

## Status definitions

- READY: the Vercel build finished. This does not verify model inference.
- Configured: a provider setting exists. This does not prove it can generate.
- Verified: an actual model request returned the expected diagnostic response.
- Unavailable: no configured provider passed an actual generation check.

## Verification

1. Confirm GitHub CI completed successfully for the intended commit.
2. Confirm the Vercel production deployment points to that commit and is READY.
3. Open the protected D.O.N.N.A. application using an authorized session.
4. Run DIAG. A successful result must identify the provider that generated the response.
5. Send a nontrivial question in chat and confirm a newly generated answer, not a canned greeting.
6. Check web research, browser voice availability, and browser-local memory independently.

## Known gap

The current DIAG route checks only the primary AI Gateway model. The chat also has
fallback models and optional direct providers, so DIAG can report a false negative.
Until the route checks the same fallback chain, treat a negative result as
inconclusive for other providers. Never claim inference works from build status.

## Boundaries

Do not change billing, payment methods, authentication settings, or secret values
as part of diagnosis. Do not print credentials or raw provider error bodies.
