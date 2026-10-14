# D.O.N.N.A. cloud memory: privacy boundary (beta)

**Status:** proposed in a draft PR. Do not interpret successful CI as proof of secure end-to-end storage or real cloud inference.

## Threat model

- Browser JavaScript, installed extensions, malware, and anyone who controls an unlocked browser profile may inspect live conversation state.
- Third-party AI providers may receive conversation prompts, attachments, and (only after explicit opt-in) selected memory notes. Those provider requests are **not end-to-end encrypted**.
- A past beta release wrote plaintext transcripts to `localStorage["donna:web:history"]` and plaintext notes to `localStorage["donna:web:memory"]`. Existing browser profiles may still contain that legacy data.

## Safer current defaults

1. New transcripts and explicit `Lembre que ...` notes live **only in the current browser tab's React state**. Reloading the page discards them; there is **no cloud synchronization**.
2. Legacy localStorage data is **not reloaded** into the assistant or echoed. The UI only enumerates storage key *names* to show a cleanup option; it does not read saved values.
3. Clearing legacy history and memory requires an explicit user click and a confirmation prompt. This deletes only the two named D.O.N.N.A. keys and does not affect other apps' storage. The deletion cannot recover backups, browser sync replicas, remote logs, or data already sent to providers.
4. Memory commands are processed before being copied into the visible chat transcript. Heuristic screening blocks notes with common explicit credential labels and limits notes to 500 characters. The note is never echoed in the confirmation.
5. Sharing notes with the model is **off by default**. Enabling the memory-sharing checkbox allows a maximum of 20 screened notes to be sent in the next chat requests. This can disclose notes to the configured AI provider; consent can be withdrawn by unchecking the option.

## Limitations and release blockers

- **Not E2EE:** the browser holds plaintext in memory while the tab is open, and the model gateway/provider must process user prompts in plaintext. TLS in transit is different from E2EE. No cryptographic persistent-memory vault is implemented.
- The sensitive-text detector is **not** a comprehensive data-loss-prevention system. Secrets can appear without recognizable labels, and innocent text can trigger false positives. Never enter credentials, recovery codes or tokens in the beta, even with session-only storage.
- Regular chat prompts and deliberately selected files still travel to the configured model service. Model processing and third-party retention policies must be evaluated independently.
- This change does **not** fix authentication, access controls, usage quotas, rate limiting, or metering for billable cloud endpoints; see issues #18 and #19.
- Tests exercise the note guard, opt-in behavior, legacy-key handling, and a source-level non-persistence invariant. They do not establish security against XSS, malware, browser extensions, or provider compromise.

## Future secure persistent memory

A future opted-in version should use reviewed primitives (for example, Web Crypto AES-GCM with random nonces and separate owner-managed encryption keys), explicit backup/recovery and deletion policies, versioned ciphertext, and a published key/lifecycle threat model. Do not call a feature E2EE unless servers and providers genuinely cannot decrypt the protected content.

## Manual verification checklist

- [ ] Fresh browser profile: memory note is visible during the session, but absent after a page reload.
- [ ] Without consent, the request body sends no memory notes to `/api/chat`.
- [ ] After explicit opt-in, only approved notes are included; disabling opt-in prevents subsequent inclusion.
- [ ] Rejected credential-labeled notes do not enter the visible chat or memory list.
- [ ] Legacy keys remain untouched without user confirmation; cleanup removes only those two keys.
- [ ] CI, Security Guard, typecheck, build and browser smoke tests pass for the *same* commit.
