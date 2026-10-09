import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyProbeFailure,
  gatewayCandidates,
  matchesProbeAnswer,
  runInferenceProbes,
} from "../lib/diagnostics.ts";

test("accepts only an actual verification marker", () => {
  for (const value of ["DONNA_OK", " DONNA_OK ", "donna_ok!", "'DONNA_OK'", "`DONNA_OK`"]) {
    assert.equal(matchesProbeAnswer(value), true, value);
  }
  for (const value of ["", "DONNA_OK maybe", "Welcome to DONNA_OK", "DONNA_OK\nextra", "OK"]) {
    assert.equal(matchesProbeAnswer(value), false, value);
  }
});

test("model list removes duplicates and preserves preferred model", () => {
  assert.deepEqual(gatewayCandidates("google/gemini-2.5-flash-lite"), [
    "google/gemini-2.5-flash-lite",
    "openai/gpt-5.4-nano",
  ]);
});

test("successful first provider is proof; later providers are not called", async () => {
  let calls = 0;
  const result = await runInferenceProbes([
    { provider: "ai-gateway:primary", run: async () => "DONNA_OK" },
    { provider: "openai-direct", run: async () => { calls += 1; return "DONNA_OK"; } },
  ]);
  assert.equal(result.inferenceVerified, true);
  assert.equal(result.provider, "ai-gateway:primary");
  assert.equal(result.attempts.length, 1);
  assert.equal(calls, 0);
});

test("invalid answer does not falsely validate AI and uses next provider", async () => {
  const result = await runInferenceProbes([
    { provider: "ai-gateway:primary", run: async () => "Hello! How can I help?" },
    { provider: "ai-gateway:secondary", run: async () => "DONNA_OK" },
  ]);
  assert.equal(result.inferenceVerified, true);
  assert.equal(result.provider, "ai-gateway:secondary");
  assert.equal(result.attempts[0]?.status, "UNEXPECTED_ANSWER");
});

test("blocked Gateway skips other Gateway models while preserving direct fallback", async () => {
  let called = 0;
  const result = await runInferenceProbes([
    { provider: "ai-gateway:primary", run: async () => { throw { statusCode: 402 }; } },
    { provider: "ai-gateway:secondary", run: async () => { called += 1; return "DONNA_OK"; } },
    { provider: "google-direct", run: async () => "DONNA_OK" },
  ]);
  assert.equal(called, 0);
  assert.equal(result.inferenceVerified, true);
  assert.equal(result.provider, "google-direct");
  assert.equal(result.attempts.length, 2);
});

test("per-model rate limiting still tries another Gateway candidate", async () => {
  const result = await runInferenceProbes([
    { provider: "ai-gateway:primary", run: async () => { throw { statusCode: 429 }; } },
    { provider: "ai-gateway:secondary", run: async () => "DONNA_OK" },
  ]);
  assert.equal(result.inferenceVerified, true);
  assert.equal(result.attempts[0]?.status, "GATEWAY_RATE_LIMIT");
});

test("unknown/empty provider results never claim success", async () => {
  const result = await runInferenceProbes([
    { provider: "ai-gateway:primary", run: async () => "" },
  ]);
  assert.equal(result.inferenceVerified, false);
  assert.equal(result.testStatus, "UNEXPECTED_ANSWER");
});

test("no configured providers is not success", async () => {
  const result = await runInferenceProbes([]);
  assert.equal(result.inferenceVerified, false);
  assert.equal(result.provider, "none");
});

test("probe count is strictly limited to five", async () => {
  let calls = 0;
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    provider: `provider-${index}`,
    run: async () => { calls += 1; return "NO"; },
  }));
  const result = await runInferenceProbes(candidates);
  assert.equal(calls, 5);
  assert.equal(result.attempts.length, 5);
});

test("secret-looking SDK errors are classified but never reflected to client", async () => {
  const result = await runInferenceProbes([
    { provider: "ai-gateway:model", run: async () => { throw new Error("unauthorized key SECRET_EXAMPLE_123"); } },
  ]);
  assert.equal(result.inferenceVerified, false);
  assert.equal(result.testStatus, "GATEWAY_AUTH");
  assert.equal(JSON.stringify(result).includes("SECRET_EXAMPLE_123"), false);
});

test("known provider errors map to safe classifications", () => {
  const cases = [
    [{ statusCode: 402 }, "GATEWAY_CREDITS"],
    [{ statusCode: 429 }, "GATEWAY_RATE_LIMIT"],
    [{ statusCode: 403 }, "GATEWAY_AUTH"],
    [{ statusCode: 404 }, "GATEWAY_MODEL"],
    [{ statusCode: 504 }, "GATEWAY_NETWORK"],
    [{ message: "customer_verification_required" }, "ACCOUNT_VERIFICATION_REQUIRED"],
    [{ message: "AbortError: timeout" }, "GATEWAY_NETWORK"],
    [new Error("unexpected"), "PROVIDER_ERROR"],
  ];
  for (const [error, expected] of cases) {
    assert.equal(classifyProbeFailure(error), expected);
  }
});
