import { test } from "node:test";
import assert from "node:assert/strict";
import { research, trustedSummaryUrl } from "../lib/research.ts";

test("enrichment only accepts exact trusted Wikipedia origins", () => {
  const allowed = [
    "https://pt.wikipedia.org/wiki/Resposta_a_incidentes",
    "https://en.wikipedia.org/wiki/Incident_response",
  ];
  for (const url of allowed) assert.equal(trustedSummaryUrl(url), true, url);

  const denied = [
    "http://pt.wikipedia.org/wiki/Test",
    "https://evilwikipedia.org/wiki/Test",
    "https://pt.wikipedia.org.evil.test/wiki/Test",
    "https://attacker.test/wiki/Test",
    "https://127.0.0.1/wiki/Test",
    "https://localhost/wiki/Test",
    "https://[::1]/wiki/Test",
    "https://evil.test@pt.wikipedia.org.evil.test/wiki/Test",
    "https://user:pass@pt.wikipedia.org/wiki/Test",
    "https://pt.wikipedia.org:444/wiki/Test",
    "https://pt.wikipedia.org/w/api.php",
    "https://pt.wikipedia.org/wiki/",
    "javascript:alert(1)",
    "not a URL",
  ];
  for (const url of denied) assert.equal(trustedSummaryUrl(url), false, url);
});

test("untrusted search result URLs remain references and are never fetched", async () => {
  const before = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(target);
    assert.equal(init?.redirect, "error", "Provider search must refuse redirects");
    if (target.startsWith("https://html.duckduckgo.com/html/")) {
      return new Response(
        '<a class="result__a" href="https://attacker.example/incident-response">incident response handbook</a>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (target.startsWith("https://pt.wikipedia.org/w/api.php")) {
      return Response.json({ query: { search: [] } });
    }
    throw Error("Unexpected server-side fetch: " + target);
  };
  try {
    const sources = await research("incident response");
    assert.equal(sources.length, 1);
    assert.equal(sources[0].url, "https://attacker.example/incident-response");
    assert.equal(sources[0].excerpt, "");
    assert.equal(calls.length, 2, "Only the two fixed search providers are queried");
  } finally {
    globalThis.fetch = before;
  }
});

test("trusted encyclopedia results can be enriched through a fixed host only", async () => {
  const before = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(target);
    assert.equal(init?.redirect, "error");
    if (target.startsWith("https://html.duckduckgo.com/html/")) {
      return new Response("", { status: 200 });
    }
    if (target.startsWith("https://pt.wikipedia.org/w/api.php")) {
      return Response.json({
        query: { search: [{ title: "Resposta a incidentes", snippet: "Resposta a incidentes de seguranca" }] },
      });
    }
    if (target.startsWith("https://pt.wikipedia.org/api/rest_v1/page/summary/")) {
      return Response.json({ extract: "Resposta a incidentes e a disciplina de investigar e conter ataques." });
    }
    throw Error("Unexpected external fetch: " + target);
  };
  try {
    const result = await research("resposta incidentes");
    assert.equal(result.length, 1);
    assert.match(result[0].excerpt, /investigar/);
    assert.ok(calls.every((url) =>
      url.startsWith("https://html.duckduckgo.com/") ||
      url.startsWith("https://pt.wikipedia.org/"),
    ));
  } finally {
    globalThis.fetch = before;
  }
});

test("limits provider response body even when Content-Length lies", async () => {
  const before = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(target);
    assert.equal(init?.redirect, "error");
    if (target.startsWith("https://html.duckduckgo.com/")) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(280 * 1024).fill(97));
          controller.enqueue(new Uint8Array(30 * 1024).fill(97));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-length": "10" } });
    }
    if (target.startsWith("https://pt.wikipedia.org/w/api.php")) {
      return Response.json({ query: { search: [] } });
    }
    throw Error("Unexpected outgoing request " + target);
  };
  try {
    assert.deepEqual(await research("incident response"), []);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = before;
  }
});

test("oversized Wikipedia summaries are not consumed as article context", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    assert.equal(init?.redirect, "error");
    if (target.startsWith("https://html.duckduckgo.com/")) return new Response("");
    if (target.startsWith("https://pt.wikipedia.org/w/api.php")) {
      return Response.json({
        query: { search: [{ title: "Resposta a incidentes", snippet: "Resposta a incidentes" }] },
      });
    }
    if (target.startsWith("https://pt.wikipedia.org/api/rest_v1/page/summary/")) {
      return new Response("A".repeat(40 * 1024), { headers: { "content-length": "10" } });
    }
    throw Error("Unexpected outgoing request " + target);
  };
  try {
    const sources = await research("resposta incidentes");
    assert.equal(sources.length, 1);
    assert.equal(sources[0].excerpt, "Resposta a incidentes");
  } finally {
    globalThis.fetch = before;
  }
});
