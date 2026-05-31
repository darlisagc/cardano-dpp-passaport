import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { PAYLOAD_BUILDERS, buildPayloadEnv } from "./payloads.ts";
import type { PayloadEnv } from "./payloads.ts";
import { dataHash } from "./hash.ts";

const SUFFIX = "a1b2c3";

function makeEnv(overrides: Partial<PayloadEnv> = {}): PayloadEnv {
  return { suffix: SUFFIX, ...overrides };
}

// ── payloadOrigem ────────────────────────────────────────────────

Deno.test("payloadOrigem includes correct template_id and update_policy", async () => {
  const { payload } = await PAYLOAD_BUILDERS.origem(makeEnv());
  assertEquals(payload.uverify_template_id, "digitalProductPassport");
  assertEquals(payload.uverify_update_policy, "restricted");
});

Deno.test("payloadOrigem has no ref_* fields (first in chain)", async () => {
  const { payload } = await PAYLOAD_BUILDERS.origem(makeEnv());
  const refKeys = Object.keys(payload).filter((k) => k.startsWith("ref_"));
  assertEquals(refKeys.length, 0);
});

Deno.test("payloadOrigem includes gtin, uv_url_serial, issuer, name", async () => {
  const { payload, gtin } = await PAYLOAD_BUILDERS.origem(makeEnv());
  assertEquals(gtin, "7891234560099");
  assertEquals(payload.gtin, "7891234560099");
  assertStringIncludes(payload.name ?? "", "Litio");
  assertStringIncludes(payload.issuer ?? "", "MineraLitio");
  assertEquals(typeof payload.uv_url_serial, "string");
  assertEquals(payload.uv_url_serial?.length, 64);
});

// ── payloadCelula ────────────────────────────────────────────────

Deno.test("payloadCelula throws without ator1Tx", async () => {
  await assertRejects(
    () => PAYLOAD_BUILDERS.celula(makeEnv()),
    Error,
    "ATOR1_TX is required",
  );
});

Deno.test("payloadCelula includes ref_origem_tx matching ator1Tx", async () => {
  const env = makeEnv({ ator1Tx: "abc123txhash" });
  const { payload } = await PAYLOAD_BUILDERS.celula(env);
  assertEquals(payload.ref_origem_tx, "abc123txhash");
});

Deno.test("payloadCelula includes ref_origem_data_hash matching dataHash(GTIN_ORIGEM, serial)", async () => {
  const env = makeEnv({ ator1Tx: "abc123txhash" });
  const { payload } = await PAYLOAD_BUILDERS.celula(env);
  const expectedHash = await dataHash("7891234560099", `ML-JQT-2026-05-${SUFFIX}`);
  assertEquals(payload.ref_origem_data_hash, expectedHash);
});

// ── payloadPack ──────────────────────────────────────────────────

Deno.test("payloadPack throws without ator2Tx", async () => {
  await assertRejects(
    () => PAYLOAD_BUILDERS.pack(makeEnv()),
    Error,
    "ATOR2_TX is required",
  );
});

Deno.test("payloadPack includes ref_celula_tx and ref_celula_data_hash", async () => {
  const env = makeEnv({ ator2Tx: "celula_tx_hash_456" });
  const { payload } = await PAYLOAD_BUILDERS.pack(env);
  assertEquals(payload.ref_celula_tx, "celula_tx_hash_456");
  const expectedHash = await dataHash("7891234560105", `CT-BA-2026-05-${SUFFIX}`);
  assertEquals(payload.ref_celula_data_hash, expectedHash);
});

// ── payloadReciclagem ────────────────────────────────────────────

Deno.test("payloadReciclagem throws without all 3 tx hashes", async () => {
  await assertRejects(
    () => PAYLOAD_BUILDERS.reciclagem(makeEnv({ ator1Tx: "a" })),
    Error,
    "ATOR1_TX, ATOR2_TX, and ATOR3_TX are all required",
  );
});

Deno.test("payloadReciclagem references all 3 previous actors", async () => {
  const env = makeEnv({
    ator1Tx: "tx_origem",
    ator2Tx: "tx_celula",
    ator3Tx: "tx_pack",
  });
  const { payload } = await PAYLOAD_BUILDERS.reciclagem(env);
  assertEquals(payload.ref_origem_tx, "tx_origem");
  assertEquals(payload.ref_celula_tx, "tx_celula");
  assertEquals(payload.ref_pack_tx, "tx_pack");
  // Verify data_hash references exist
  assertEquals(typeof payload.ref_origem_data_hash, "string");
  assertEquals(typeof payload.ref_celula_data_hash, "string");
  assertEquals(typeof payload.ref_pack_data_hash, "string");
});

// ── buildPayloadEnv ──────────────────────────────────────────────

Deno.test("buildPayloadEnv returns 6-char suffix", async () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
  const env = await buildPayloadEnv(mnemonic);
  assertEquals(env.suffix.length, 6);
  assertEquals(/^[0-9a-f]{6}$/.test(env.suffix), true);
});
