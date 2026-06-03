/**
 * Tests for reports/verification-report.ts — verification report HTML generation.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { generateVerificationReport } from "../../src/reports/verification-report.ts";
import type { VerificationReportInput } from "../../src/reports/verification-report.ts";
import type { VerifiedCredential } from "../../src/verify.ts";

function makeCred(overrides: Partial<VerifiedCredential> = {}): VerifiedCredential {
  return {
    name: "Lote Litio LCE-99",
    issuer: "MineraLitio Jequitinhonha",
    gtin: "7891234560099",
    origin: "Aracuai, MG",
    manufactured: "2026-05",
    carbonFootprint: "3.2 kg CO2e/kg",
    recycledContent: undefined,
    materials: { mat_litio_carbonato: "98%" },
    references: {},
    dataHashes: {},
    txHash: "abc123txhash",
    ...overrides,
  };
}

function makeFullInput(): VerificationReportInput {
  return {
    origem: makeCred(),
    celula: makeCred({
      name: "Celulas NMC 811",
      issuer: "CellTech Brasil",
      gtin: "7891234560105",
      txHash: "celula_tx",
      materials: { mat_catodo_nmc: "92%", mat_eletrolito: "LP30" },
      references: { origem_tx: "abc123txhash" },
    }),
    pack: makeCred({
      name: "Pack EV 75kWh",
      issuer: "PackMontadora SP",
      gtin: "7891234560112",
      txHash: "pack_tx",
      materials: {},
      references: { celula_tx: "celula_tx" },
    }),
  };
}

// ── Basic HTML structure ─────────────────────────────────────────────

Deno.test("generateVerificationReport returns valid HTML document", () => {
  const html = generateVerificationReport(makeFullInput());
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, '<html lang="pt-BR">');
  assertStringIncludes(html, "</html>");
});

Deno.test("generateVerificationReport includes page title", () => {
  const html = generateVerificationReport(makeFullInput());
  assertStringIncludes(html, "Passaporte Digital de Produto");
  assertStringIncludes(html, "Bateria EV");
});

// ── Supply chain flow diagram ────────────────────────────────────────

Deno.test("generateVerificationReport includes 3-step flow without reciclagem", () => {
  const html = generateVerificationReport(makeFullInput());
  assertStringIncludes(html, "flow-step origem");
  assertStringIncludes(html, "flow-step celula");
  assertStringIncludes(html, "flow-step pack");
  assertEquals(html.includes("flow-step reciclagem"), false);
});

Deno.test("generateVerificationReport includes 4-step flow with reciclagem", () => {
  const input = makeFullInput();
  input.reciclagem = makeCred({
    name: "Reciclagem Pack EV",
    issuer: "RecicLar Sorocaba",
    gtin: "7891234560129",
    txHash: "recicl_tx",
    references: { pack_tx: "pack_tx", celula_tx: "celula_tx", origem_tx: "abc123txhash" },
  });
  const html = generateVerificationReport(input);
  assertStringIncludes(html, "flow-step reciclagem");
});

// ── Credential cards ─────────────────────────────────────────────────

Deno.test("generateVerificationReport includes all credential cards", () => {
  const html = generateVerificationReport(makeFullInput());
  assertStringIncludes(html, "Origem");
  assertStringIncludes(html, "lulas"); // "Fabricação das células"
  assertStringIncludes(html, "pack");
});

Deno.test("generateVerificationReport shows credential data", () => {
  const html = generateVerificationReport(makeFullInput());
  assertStringIncludes(html, "MineraLitio Jequitinhonha");
  assertStringIncludes(html, "CellTech Brasil");
  assertStringIncludes(html, "PackMontadora SP");
  assertStringIncludes(html, "7891234560099");
});

Deno.test("generateVerificationReport shows materials", () => {
  const html = generateVerificationReport(makeFullInput());
  assertStringIncludes(html, "litio_carbonato");
  assertStringIncludes(html, "98%");
});

// ── Missing credentials ──────────────────────────────────────────────

Deno.test("generateVerificationReport shows placeholder for missing credential", () => {
  const input: VerificationReportInput = {
    origem: undefined,
    celula: undefined,
    pack: makeCred({
      name: "Pack EV 75kWh",
      issuer: "PackMontadora SP",
    }),
  };
  const html = generateVerificationReport(input);
  assertStringIncludes(html, "credencial ausente");
});

// ── Tx links ─────────────────────────────────────────────────────────

Deno.test("generateVerificationReport includes Cexplorer tx links", () => {
  const html = generateVerificationReport(makeFullInput());
  assertStringIncludes(html, "preprod.cexplorer.io/tx/abc123txhash");
});

// ── Verified banner ──────────────────────────────────────────────────

Deno.test("generateVerificationReport includes verified banner", () => {
  const html = generateVerificationReport(makeFullInput());
  assertStringIncludes(html, "Certificado Verificado");
  assertStringIncludes(html, "Verificado na Blockchain Cardano");
});

// ── Color-coded cards ────────────────────────────────────────────────

Deno.test("generateVerificationReport uses correct actor colors", () => {
  const html = generateVerificationReport(makeFullInput());
  assertStringIncludes(html, "#2e7d32"); // origem green
  assertStringIncludes(html, "#1565c0"); // celula blue
  assertStringIncludes(html, "#f9a825"); // pack amber
});
