import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameOrigin, parseJsonBody, privateJson, readBoundedBody, validatedResearchQuery } from "../lib/request-guard.ts";

const URL = "https://donna.example/api/chat";
function request(payload, headers = {}) {
  return new Request(URL, {
    method: "POST",
    headers: {
      origin: "https://donna.example",
      "content-type": "application/json",
      ...headers,
    },
    body: payload,
  });
}

test("accepts small same-origin JSON without altering its bytes", async () => {
  const body = '{"message":"olá"}';
  const result = await readBoundedBody(request(body), "application/json", 1024);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(parseJsonBody(result.bytes), { message: "olá" });
});

test("rejects absent, opaque, malformed and cross-origin requests", async () => {
  const origins = [undefined, "null", "https://attacker.example", "bad://", "https://donna.example.evil", "http://donna.example", "https://donna.example/path"];
  for (const origin of origins) {
    const headers = { "content-type": "application/json" };
    if (origin !== undefined) headers.origin = origin;
    const req = new Request(URL, { method: "POST", headers, body: "{}" });
    assert.equal(isSameOrigin(req), false, String(origin));
    const outcome = await readBoundedBody(req, "application/json", 1024);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.response.status, 403);
  }
});

test("rejects wrong media type before provider invocation", async () => {
  const result = await readBoundedBody(request("{}", { "content-type": "text/plain" }), "application/json", 1024);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 415);
});

test("rejects oversized declared Content-Length even with small body", async () => {
  const result = await readBoundedBody(request("{}", { "content-length": "999999" }), "application/json", 128);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 413);
});

test("rejects malformed Content-Length", async () => {
  const result = await readBoundedBody(request("{}", { "content-length": "-1" }), "application/json", 128);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 400);
});

test("enforces actual stream size without trusting Content-Length", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(60));
      controller.enqueue(new Uint8Array(60));
      controller.close();
    },
  });
  const req = new Request(URL, {
    method: "POST",
    headers: { origin: "https://donna.example", "content-type": "application/json", "content-length": "1" },
    body: stream,
    duplex: "half",
  });
  const result = await readBoundedBody(req, "application/json", 100);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 413);
});

test("rejects empty bodies and malformed or non-object JSON", async () => {
  const empty = await readBoundedBody(request(""), "application/json", 100);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.response.status, 400);
  for (const payload of ["bad", "[]", "null", "4", '"word"']) {
    assert.equal(parseJsonBody(new TextEncoder().encode(payload)), null);
  }
});

test("strict UTF-8 decoder rejects invalid binary JSON", () => {
  assert.equal(parseJsonBody(new Uint8Array([123, 34, 255, 34, 58, 49, 125])), null);
});

test("multipart requires a boundary in Content-Type", async () => {
  const res = await readBoundedBody(
    request("file", { "content-type": "multipart/form-data" }),
    "multipart/form-data",
    1024,
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.response.status, 415);
});

test("rejected requests have no-store responses and never echo input", async () => {
  const secret = "DO_NOT_ECHO_FAKE_TEST_SECRET";
  const res = await readBoundedBody(request(secret, { origin: "https://evil.test" }), "application/json", 1024);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.response.headers.get("Cache-Control"), "no-store");
    assert.equal((await res.response.text()).includes(secret), false);
  }
});

test("private JSON output carries no-store on success and errors", async () => {
  const secret = "FAKE_USER_DATA";
  const response = privateJson({ answer: secret });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).answer, secret);
  const error = privateJson({ error: "Invalid" }, { status: 422 });
  assert.equal(error.status, 422);
  assert.equal(error.headers.get("Cache-Control"), "no-store");
});

test("research queries reject empty, oversized, and control-character input", () => {
  for (const bad of [null, "", "   ", "A".repeat(171), "term\u0000another", "abc\nsecret"]) {
    assert.equal(validatedResearchQuery(bad), null);
  }
  assert.equal(validatedResearchQuery("  criptografia segura  "), "criptografia segura");
  assert.equal(validatedResearchQuery("A".repeat(170)), "A".repeat(170));
});
