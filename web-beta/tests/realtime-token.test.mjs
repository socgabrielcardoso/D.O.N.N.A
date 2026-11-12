import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/realtime/token/route.ts";

test("public realtime token endpoint fails closed", async () => {
  const response = await POST();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
  const body = await response.json();
  assert.equal(body.code, "REALTIME_VOICE_DISABLED");
  assert.equal(typeof body.error, "string");
  assert.equal("token" in body, false);
  assert.equal("url" in body, false);
  assert.equal("secret" in body, false);
});

test("no accidental credentials are revealed even when provider environment is set", async () => {
  const fakeSecret = "TEST_DO_NOT_LEAK_REALTIMETOKEN";
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = fakeSecret;
  try {
    const response = await POST();
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.equal(body.includes(fakeSecret), false);
    assert.equal(body.includes("Bearer "), false);
  } finally {
    if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previous;
  }
});

test("different repeated requests cannot mint sessions", async () => {
  for (let i = 0; i < 5; i += 1) {
    const response = await POST();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "REALTIME_VOICE_DISABLED");
  }
});
