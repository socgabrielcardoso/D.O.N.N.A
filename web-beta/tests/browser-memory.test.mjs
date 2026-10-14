import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("rejects invisible Unicode obfuscation and control characters", () => {
  const invisible = String.fromCharCode(0x200b);
  const bidiOverride = String.fromCharCode(0x202e);
  const nullByte = String.fromCharCode(0);
  const hiddenLabel = "pass" + invisible + "word";
  for (const note of ["minha " + hiddenLabel, "preferencia" + bidiOverride, "texto" + nullByte]) {
    assert.equal(containsSensitiveMemoryText(note), true);
    assert.equal(canRememberNote(note), false);
    assert.deepEqual(memoriesForProvider(["prefiro PT-BR", note], true), ["prefiro PT-BR"]);
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

test("inspects legacy storage key names without reading any stored values", () => {
  const inspected = [];
  const store = new Map([["other-app:key", "retain"]]);
  const storage = {
    get length() { return store.size; },
    key(index) {
      const name = [...store.keys()][index] ?? null;
      inspected.push(name);
      return name;
    },
    getItem() {
      throw new Error("Legacy values must never be loaded during detection");
    },
  };

  assert.equal(hasLegacyBrowserStorage(storage), false);
  store.set("donna:web:memory", "legacy value");
  assert.equal(hasLegacyBrowserStorage(storage), true);
  assert.ok(inspected.every((name) => name === null || [...LEGACY_BROWSER_STORAGE_KEYS, "other-app:key"].includes(name)));
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

test("web cockpit does not silently write plaintext transcript or memory to localStorage", () => {
  const source = readFileSync(new URL("../app/cockpit.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage\s*\.\s*setItem\s*\(/);
  assert.match(source, /useState\(false\).*shareMemoriesWithAI|shareMemoriesWithAI, setShareMemoriesWithAI\] = useState\(false\)/);
  assert.match(source, /memory:\s*memoriesForProvider\(memories, shareMemoriesWithAI\)/);
});

test("memory commands are handled before raw input enters chat transcript", () => {
  const source = readFileSync(new URL("../app/cockpit.tsx", import.meta.url), "utf8");
  const askSection = source.slice(source.indexOf("const ask = useCallback("), source.indexOf("const browserListenFallback"));
  const validated = askSection.indexOf("if (localMemoryCommand(message)) return;");
  const rawTranscript = askSection.indexOf("provider: \"web-input\"");
  assert.ok(validated >= 0);
  assert.ok(rawTranscript > validated);
});
