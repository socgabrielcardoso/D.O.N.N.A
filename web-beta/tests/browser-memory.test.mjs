import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_BROWSER_STORAGE_KEYS,
  canRememberNote,
  clearLegacyBrowserStorage,
  containsSensitiveMemoryText,
  hasLegacyBrowserStorage,
  memoriesForProvider,
} from "../lib/browser-memory.ts";

test("rejects explicit Portuguese and English credential labels", () => {
  for (const phrase of [
    "minha senha é um exemplo",
    "password for my account",
    "api_key é confidencial",
    "access-token de sessão",
    "refresh token de acesso",
    "chave privada",
    "código de recuperação",
    "ｐａｓｓｗｏｒｄ is private",
  ]) {
    assert.equal(containsSensitiveMemoryText(phrase), true, phrase);
    assert.equal(canRememberNote(phrase), false, phrase);
  }
});

test("accepts harmless short preferences without assuming they are encrypted", () => {
  for (const phrase of [
    "prefiro respostas curtas",
    "lembre que estudo segurança no Linux",
    "gosto de uma voz feminina em português",
  ]) {
    assert.equal(containsSensitiveMemoryText(phrase), false, phrase);
    assert.equal(canRememberNote(phrase), true, phrase);
  }
});

test("rejects empty and oversized memory notes", () => {
  assert.equal(canRememberNote(""), false);
  assert.equal(canRememberNote("  "), false);
  assert.equal(canRememberNote("x".repeat(500)), true);
  assert.equal(canRememberNote("x".repeat(501)), false);
});

test("inspects legacy storage keys without loading their values into memory", () => {
  const read = [];
  const store = new Map([["other-app:key", "retain"]]);
  const storage = {
    getItem(key) {
      read.push(key);
      return store.has(key) ? store.get(key) : null;
    },
  };

  assert.equal(hasLegacyBrowserStorage(storage), false);
  store.set("donna:web:memory", "legacy value");
  assert.equal(hasLegacyBrowserStorage(storage), true);
  assert.ok(read.every((key) => LEGACY_BROWSER_STORAGE_KEYS.includes(key)));
});

test("explicit legacy data cleanup never touches unrelated browser storage", () => {
  const store = new Map([
    ["donna:web:history", "old history"],
    ["donna:web:memory", "old memory"],
    ["other-app:key", "retain"],
  ]);
  const storage = { removeItem(key) { store.delete(key); } };
  clearLegacyBrowserStorage(storage);
  assert.equal(store.has("donna:web:history"), false);
  assert.equal(store.has("donna:web:memory"), false);
  assert.equal(store.get("other-app:key"), "retain");
});

test("memory is not sent to model providers without affirmative consent", () => {
  const notes = ["prefiro respostas objetivas", "uso Linux"];
  assert.deepEqual(memoriesForProvider(notes, false), []);
  assert.deepEqual(memoriesForProvider(notes, true), notes);
});

test("even with consent, blocked memory notes are excluded from AI requests", () => {
  const notes = ["prefiro voz PT-BR", "password is example", "estudo Blue Team"];
  assert.deepEqual(memoriesForProvider(notes, true), ["prefiro voz PT-BR", "estudo Blue Team"]);
});
