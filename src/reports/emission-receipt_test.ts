/**
 * Tests for reports/emission-receipt.ts — emission receipt HTML generation.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { generateEmissionReceipt } from "./emission-receipt.ts";
import type { EmissionReceiptInput } from "./emission-receipt.ts";
import type { DppPayload } from "../types.ts";

function makePayload(overrides: Partial<DppPayload> = {}): DppPayload {
  return {
    name: "Lote Litio LCE-99",
    issuer: "MineraLitio Jequitinhonha",
    gtin: "7891234560099",
    origin: "Aracuai, MG",
    manufactured: "2026-05",
    carbon_footprint: "3.2 kg CO2e/kg",
    uverify_template_id: "digitalProductPassport",
    uverify_update_policy: "restricted",
    ...overrides,
  };
}

function makeInput(overrides: Partial<EmissionReceiptInput> = {}): EmissionReceiptInput {
  return {
    actor: "origem",
    payload: makePayload(),
    txHash: "5b1b062887313c4a263661d197f818240f9245f53749adac9fd4f36cd835cb80",
    dataHash: "b5672c6d811f1c8f13bddaac6c4de75b2768fa708a60e530d534f236bb6a3dd3",
    ...overrides,
  };
}

// ── Basic HTML structure ─────────────────────────────────────────────

Deno.test("generateEmissionReceipt returns valid HTML document", () => {
  const html = generateEmissionReceipt(makeInput());
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, '<html lang="pt-BR">');
  assertStringIncludes(html, "</html>");
  assertStringIncludes(html, "<style>");
});

Deno.test("generateEmissionReceipt includes actor title in header", () => {
  const html = generateEmissionReceipt(makeInput());
  assertStringIncludes(html, "Origem do Litio");
  assertStringIncludes(html, "MineraLitio Jequitinhonha");
});

Deno.test("generateEmissionReceipt includes tx hash with Cexplorer link", () => {
  const html = generateEmissionReceipt(makeInput());
  assertStringIncludes(html, "preprod.cexplorer.io/tx/5b1b0628");
  assertStringIncludes(html, "b5672c6d811f1c8f13bddaac6c4de75b2768fa708a60e530d534f236bb6a3dd3");
});

Deno.test("generateEmissionReceipt includes payload fields", () => {
  const html = generateEmissionReceipt(makeInput());
  assertStringIncludes(html, "Lote Litio LCE-99");
  assertStringIncludes(html, "7891234560099");
  assertStringIncludes(html, "Aracuai, MG");
  assertStringIncludes(html, "3.2 kg CO2e/kg");
});

// ── Materials section ────────────────────────────────────────────────

Deno.test("generateEmissionReceipt includes materials section", () => {
  const payload = makePayload({
    mat_litio_carbonato: "98%",
    mat_impurezas_ferro: "0.3%",
  });
  const html = generateEmissionReceipt(makeInput({ payload }));
  assertStringIncludes(html, "Materiais");
  assertStringIncludes(html, "litio_carbonato: 98%");
  assertStringIncludes(html, "impurezas_ferro: 0.3%");
});

Deno.test("generateEmissionReceipt omits materials section when none present", () => {
  const html = generateEmissionReceipt(makeInput());
  assertEquals(html.includes("Materiais"), false);
});

// ── References section ───────────────────────────────────────────────

Deno.test("generateEmissionReceipt includes references for celula actor", () => {
  const payload = makePayload({
    ref_origem_tx: "abc123txhash",
  });
  const html = generateEmissionReceipt(makeInput({ actor: "celula", payload }));
  assertStringIncludes(html, "Referencias na Cadeia");
  assertStringIncludes(html, "Origem");
  assertStringIncludes(html, "abc123txhash");
});

Deno.test("generateEmissionReceipt omits references for origem actor", () => {
  const html = generateEmissionReceipt(makeInput());
  assertEquals(html.includes("Referencias na Cadeia"), false);
});

// ── Actor-specific styling ───────────────────────────────────────────

Deno.test("generateEmissionReceipt uses correct actor colors", () => {
  // Pack actor should use amber color scheme
  const html = generateEmissionReceipt(makeInput({ actor: "pack" }));
  assertStringIncludes(html, "#f9a825"); // Pack card color
  assertStringIncludes(html, "Montagem do Pack");
});

Deno.test("generateEmissionReceipt reciclagem uses teal colors", () => {
  const html = generateEmissionReceipt(makeInput({ actor: "reciclagem" }));
  assertStringIncludes(html, "#004d40"); // Reciclagem header gradient from
  assertStringIncludes(html, "#00695c"); // Reciclagem header gradient to
  assertStringIncludes(html, "Reciclagem de Bateria");
});

// ── Verified banner ──────────────────────────────────────────────────

Deno.test("generateEmissionReceipt includes verified banner", () => {
  const html = generateEmissionReceipt(makeInput());
  assertStringIncludes(html, "Emissao Registrada");
  assertStringIncludes(html, "Blockchain Cardano");
});
