# Cloud research: SSRF containment and trust boundary

## What changed

Search-result URLs from DuckDuckGo and Wikipedia remain **untrusted user-facing references**, not permission for the D.O.N.N.A. server to access those URLs. Previously the server would perform a separate DNS preflight before fetching arbitrary public-looking article URLs. An attacker could in principle manipulate address resolution between the DNS check and the actual `fetch()` call (DNS rebinding / time-of-check-to-time-of-use).

The research enrichment path now requests short summaries only from **exact** `pt.wikipedia.org` and `en.wikipedia.org` HTTPS origins, and only for `/wiki/<page>` links. Strings such as `evilwikipedia.org`, lookalike subdomains, literal IP addresses, userinfo URLs and alternate ports are not trusted. Direct arbitrary site scraping was removed.

Search providers are fixed HTTPS endpoints, and their requests fail on redirects rather than following redirect chains. Decoded provider response streams are bounded before JSON/HTML parsing: 300 KiB for DuckDuckGo HTML, 64 KiB for Wikipedia search JSON and 32 KiB for Wikipedia summaries. Oversized responses are discarded instead of buffered indefinitely. When an upstream declares a body larger than the limit, the response stream is canceled without parsing. A stream that exceeds the limit during reading is also canceled without waiting for a potentially stalled cancellation acknowledgement. Malformed UTF-8 is rejected as untrusted data (no partial excerpt is returned). Cancellation is best-effort; network and reverse-proxy resource limits still apply. Each response-body reader also has an explicit five-second deadline that cancels stalled streams, even when a provider does not close its response; the upstream fetch timeouts remain in force. The returned citations from other publishers remain clickable references, but their pages are not fetched server-side.

## Functional tradeoff

- Third-party results can still be cited by title and source URL, but will often have **empty excerpts**, reducing information available for generated research responses.
- Wikipedia page summaries remain available as limited source context when the provider is reachable.
- No false claim of live search or accuracy is made by these static changes. Live preview tests must validate topic relevance, links, and behavior when providers are unavailable.
- A future version may re-introduce arbitrary article retrieval only after a reviewed, pinned network/egress design that rejects private, special and link-local IPs at **connect time**, with redirect and response-size controls. A separate unpinned DNS lookup is insufficient.

## Tests and remaining risks

The `web-beta/tests/research-network-boundary.test.mjs` suite validates exact hostname allowlisting, hostile lookalikes and userinfo, ensures attacker-controlled search result URLs are not fetched, checks Wikipedia summary enrichment, and requires search providers to reject redirects. Negative regression tests cover malformed search-result hrefs, null/non-string Wikipedia entries, oversized bodies with misleading Content-Length, immediate cancellation for declared oversize responses, cancellation that never acknowledges, invalid UTF-8, and stalled response streams. Malformed individual results are skipped while other valid sources remain usable. Run `npm run test:research-boundary`; the CI workflow runs it automatically.

The remaining network behavior includes DNS resolution for **fixed provider hosts** and dynamic page names under the exact encyclopedia origin. Rate limiting, egress policy, data minimization and provider trust still require deployment-level controls. This patch is defense in depth and **does not implement user authentication** on `/api/research`.

Tracking issue: https://github.com/socgabrielcardoso/D.O.N.N.A/issues/24

Do not paste secrets or production identifiers into test queries, commits, PRs or logs.
