import test from "node:test";
import assert from "node:assert/strict";
import { containsSensitiveMemoryText } from "../lib/browser-memory.ts";

test("rejects explicit password labels", () => {
  assert.equal(containsSensitiveMemoryText("minha senha é exemplo"), true);
});

test("allows a harmless preference", () => {
  assert.equal(containsSensitiveMemoryText("prefiro respostas curtas"), false);
});
