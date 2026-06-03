/**
 * Tests for reports/reciclagem-report.ts — recycling report HTML generation.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { generateReciclagemReport } from "./reciclagem-report.ts";
import type { ReciclagemReportInput } from "./reciclagem-report.ts";
import type { DppPayload } from "../types.ts";

function makePayload(overrides: Partial<DppPayload> = {}): DppPayload {
  return {
    name: "Reciclagem Pack EV 75kWh",
    issuer: "RecicLar Sorocaba Ltda.",
    gtin: "7891234560129",
    origin: "Sorocaba, SP",
    manufactured: "2026-05",
    carbon_footprint: "1.8 kg CO2e/kg",
    recycled_content: "94%",
    mat_litio_recuperado: "12 kg",
    mat_cobalto: "3.2 kg",
    mat_niquel: "8.1 kg",
    ref_origem_tx: "origem_tx_hash_abc",
    ref_celula_tx: "celula_tx_hash_def",
    ref_pack_tx: "pack_tx_hash_ghi",
    ref_origem_data_hash: "origem_dh",
    ref_celula_data_hash: "celula_dh",
    ref_pack_data_hash: "pack_dh",
    ...overrides,
  };
}

function makeInput(overrides: Partial<ReciclagemReportInput> = {}): ReciclagemReportInput {
  return {
    payload: makePayload(),
    txHash: "recicl_tx_hash_12345678901234567890",
    dataHash: "recicl_data_hash_abcdef1234567890",
    ...overrides,
  };
}

// ── Basic HTML structure ─────────────────────────────────────────────

Deno.test("generateReciclagemReport returns valid HTML document", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, '<html lang="pt-BR">');
  assertStringIncludes(html, "</html>");
});

Deno.test("generateReciclagemReport includes title", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "Certificado de Fim de Vida");
  assertStringIncludes(html, "Reciclagem de Bateria EV");
});

// ── Teal color scheme ────────────────────────────────────────────────

Deno.test("generateReciclagemReport uses teal color scheme", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "#004d40"); // dark teal
  assertStringIncludes(html, "#00695c"); // medium teal
  assertStringIncludes(html, "#00897b"); // light teal (materials/links)
});

// ── Lifecycle flow diagram ───────────────────────────────────────────

Deno.test("generateReciclagemReport includes lifecycle flow", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "flow-step pack");
  assertStringIncludes(html, "flow-step desmontagem");
  assertStringIncludes(html, "flow-step reciclagem");
  assertStringIncludes(html, "Pack");
  assertStringIncludes(html, "Desmontagem");
  assertStringIncludes(html, "Reciclagem");
});

// ── Recovered materials ──────────────────────────────────────────────

Deno.test("generateReciclagemReport includes recovered materials", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "Materiais Recuperados");
  assertStringIncludes(html, "litio_recuperado: 12 kg");
  assertStringIncludes(html, "cobalto: 3.2 kg");
  assertStringIncludes(html, "niquel: 8.1 kg");
});

Deno.test("generateReciclagemReport omits materials section when none present", () => {
  const payload = makePayload();
  delete payload.mat_litio_recuperado;
  delete payload.mat_cobalto;
  delete payload.mat_niquel;
  const html = generateReciclagemReport(makeInput({ payload }));
  assertEquals(html.includes("Materiais Recuperados"), false);
});

// ── Reverse traceability ─────────────────────────────────────────────

Deno.test("generateReciclagemReport includes reverse traceability", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "Rastreabilidade Reversa");
  assertStringIncludes(html, "Pack");
  assertStringIncludes(html, "Origem");
});

Deno.test("generateReciclagemReport includes Cexplorer links for references", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "preprod.cexplorer.io/tx/origem_tx_hash_abc");
  assertStringIncludes(html, "preprod.cexplorer.io/tx/celula_tx_hash_def");
  assertStringIncludes(html, "preprod.cexplorer.io/tx/pack_tx_hash_ghi");
});

// ── Credential data ──────────────────────────────────────────────────

Deno.test("generateReciclagemReport includes credential fields", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "RecicLar Sorocaba");
  assertStringIncludes(html, "7891234560129");
  assertStringIncludes(html, "Sorocaba, SP");
  assertStringIncludes(html, "94%");
});

// ── Tx link ──────────────────────────────────────────────────────────

Deno.test("generateReciclagemReport includes tx Cexplorer link", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "preprod.cexplorer.io/tx/recicl_tx_hash_12345678901234567890");
});

// ── Verified banner ──────────────────────────────────────────────────

Deno.test("generateReciclagemReport includes verified banner", () => {
  const html = generateReciclagemReport(makeInput());
  assertStringIncludes(html, "Certificado Verificado");
  assertStringIncludes(html, "reciclagem verificado na Blockchain Cardano");
  assertStringIncludes(html, "cadeia reversa completa");
});
