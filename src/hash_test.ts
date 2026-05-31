import { assertEquals, assertNotEquals } from "@std/assert";
import { dataHash, hashSerial, mnemonicSuffix } from "./hash.ts";

Deno.test("dataHash is deterministic", async () => {
  const h1 = await dataHash("7891234560099", "ML-JQT-2026-05-abc123");
  const h2 = await dataHash("7891234560099", "ML-JQT-2026-05-abc123");
  assertEquals(h1, h2);
});

Deno.test("dataHash changes when gtin changes", async () => {
  const h1 = await dataHash("7891234560099", "ML-JQT-2026-05-abc123");
  const h2 = await dataHash("7891234560105", "ML-JQT-2026-05-abc123");
  assertNotEquals(h1, h2);
});

Deno.test("dataHash changes when serial changes", async () => {
  const h1 = await dataHash("7891234560099", "ML-JQT-2026-05-abc123");
  const h2 = await dataHash("7891234560099", "ML-JQT-2026-05-xyz789");
  assertNotEquals(h1, h2);
});

Deno.test("hashSerial returns 64-char hex string", async () => {
  const h = await hashSerial("ML-JQT-2026-05-abc123");
  assertEquals(h.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(h), true);
});

Deno.test("mnemonicSuffix returns exactly 6 chars", async () => {
  const suffix = await mnemonicSuffix("word ".repeat(24).trim());
  assertEquals(suffix.length, 6);
});

Deno.test("mnemonicSuffix is deterministic", async () => {
  const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
  const s1 = await mnemonicSuffix(mnemonic);
  const s2 = await mnemonicSuffix(mnemonic);
  assertEquals(s1, s2);
});
