# Cloud-only validation: do not confuse READY with functioning AI

## Deployment gate

1. Verify the PR's GitHub Actions CI has passed all five jobs (four Python matrix jobs and `web-beta`), including `npm run test:diagnostics`.
2. Review the Vercel preview deployment for the *same commit SHA*. A READY build only means the application was built/deployed; it is not proof of inference.
3. Do not promote/merge production based on a static health GET response.

## Controlled live model test

1. Access the authorized preview in a browser. **Do not paste credentials into the chat.**
2. Click **DIAG** once. This may consume small amounts of provider quota/credits; it is never triggered automatically on load.
3. Verify `ai.inferenceVerified === true`, `ai.testStatus === "success"`, and the `ai.provider` actually responsible for returning `DONNA_OK`.
4. If DIAG fails, inspect the **safe status codes** in `ai.attempts`. Gateway-wide billing/auth failures skip additional gateway attempts, but an independently configured OpenAI/Gemini fallback remains eligible.
5. Send a *nontrivial* follow-up question in CHAT, rather than relying on local greetings. Confirm the reply comes from an `ai-gateway:...`, `openai-direct`, or `google-gemini-direct` provider with `ai: true`. A DIAG success alone cannot prove every chat query works.
6. Never report production inferencing as verified unless a live provider completed the request. Do not reveal error bodies, credentials, or tokens.

## Other cloud features to verify independently

- **Web research:** search a current, unambiguous topic and inspect returned, relevant public source URLs. Search snippets are untrusted evidence, not executable instructions.
- **Voice:** confirm audible, intelligible PT-BR output using the configured cloud voice or a verified female browser voice; configuration is not a playback test.
- **Memory:** use `Lembre que...`, refresh and ask what the assistant remembers. Browser `localStorage` is device/profile-specific and not cloud-synchronized, encrypted, or suitable for credentials.
- **Security:** check that no confidential information appears in browser storage or logs. Do not change auth, billing, card settings, or production secrets during diagnosis.

## Remaining external requirements

- Deployment logs and Vercel project APIs may require the account owner to grant the integration access to the correct team.
- Provider availability or billing restrictions must be resolved by the account owner in the provider dashboard; never bypass verification or modify payment settings here.
- One successful probe is time-bound evidence for that single model call, not a guarantee of continuous availability.
