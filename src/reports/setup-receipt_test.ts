/**
 * Tests for reports/setup-receipt.ts — setup receipt HTML generation.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { generateSetupReceipt } from "./setup-receipt.ts";
import type { SetupReceiptInput } from "./setup-receipt.ts";
import type { ActorWallet } from "../types.ts";

function makeWallet(name: string, addr: string, mnemonic: string): ActorWallet {
  return {
    name: name as ActorWallet["name"],
    address: addr,
    mnemonic,
    signTx: async () => "witness",
    signMessage: async () => ({ key: "key", signature: "sig" }),
    client: null,
  };
}

function makeInput(overrides: Partial<SetupReceiptInput> = {}): SetupReceiptInput {
  return {
    wallets: {
      origem: makeWallet(
        "origem",
        "addr_test1vzm7042plthw0m9f4ayg5jjz922yg4nfxpk79nvdfrhxuegjswrsp",
        "burst brass feel word apple stone gather open abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
      ),
      celula: makeWallet(
        "celula",
        "addr_test1vrrkx5f5p7tv56gygh6rfcux6yrljj4n840d7dqp00epjjqg6uj7u",
        "display involve invest park apple stone gather open abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
      ),
      pack: makeWallet(
        "pack",
        "addr_test1vzn8lm8ndpgh2cdjcrj9c8yuszxggwfjgmhr7fuek05fs6qk759z8",
        "wonder absurd rack park apple stone gather open abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
      ),
      reciclagem: makeWallet(
        "reciclagem",
        "addr_test1vzuf5dluxkv7w5yf7qp6y0723g2r8madn9fuykwgqpanulggtzvwg",
        "pulp vital actual park apple stone gather open abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
      ),
    },
    fundingTxHash: "606b48174b94cb0f7f1d80018136b9b24e913f0d4382221379e48b4f1f022659",
    adaPerWallet: 50,
    ...overrides,
  };
}

// ── Basic HTML structure ─────────────────────────────────────────────

Deno.test("generateSetupReceipt returns valid HTML document", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, '<html lang="pt-BR">');
  assertStringIncludes(html, "</html>");
});

Deno.test("generateSetupReceipt includes title", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(html, "Setup Completo");
  assertStringIncludes(html, "Carteiras e Financiamento");
});

// ── Wallet table ─────────────────────────────────────────────────────

Deno.test("generateSetupReceipt includes all 4 actor addresses", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(html, "addr_test1vzm7042plthw0m9");
  assertStringIncludes(html, "addr_test1vrrkx5f5p7tv56g");
  assertStringIncludes(html, "addr_test1vzn8lm8ndpgh2cd");
  assertStringIncludes(html, "addr_test1vzuf5dluxkv7w5y");
});

Deno.test("generateSetupReceipt masks mnemonics (shows only first 3 words)", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(html, "burst brass feel ...");
  assertStringIncludes(html, "display involve invest ...");
  // Full mnemonic should NOT appear
  assertEquals(html.includes("abandon abandon abandon art"), false);
});

Deno.test("generateSetupReceipt includes actor labels", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(html, "Origem");
  assertStringIncludes(html, "Pack");
  assertStringIncludes(html, "Reciclagem");
});

Deno.test("generateSetupReceipt includes company names", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(html, "MineraLitio Jequitinhonha");
  assertStringIncludes(html, "CellTech Brasil");
  assertStringIncludes(html, "PackMontadora SP");
  assertStringIncludes(html, "RecicLar Sorocaba");
});

// ── Funding card ─────────────────────────────────────────────────────

Deno.test("generateSetupReceipt includes funding tx details", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(html, "Transacao de Financiamento");
  assertStringIncludes(html, "50 ADA");
  assertStringIncludes(html, "200 ADA");
  assertStringIncludes(html, "4 carteiras");
});

Deno.test("generateSetupReceipt includes Cexplorer link for funding tx", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(
    html,
    "preprod.cexplorer.io/tx/606b48174b94cb0f7f1d80018136b9b24e913f0d4382221379e48b4f1f022659",
  );
});

Deno.test("generateSetupReceipt calculates total ADA correctly", () => {
  const html = generateSetupReceipt(makeInput({ adaPerWallet: 20 }));
  assertStringIncludes(html, "20 ADA");
  assertStringIncludes(html, "80 ADA");
});

// ── Verified banner ──────────────────────────────────────────────────

Deno.test("generateSetupReceipt includes verified banner", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(html, "Setup Concluido");
  assertStringIncludes(html, "Carteiras criadas e financiadas on-chain");
});

// ── Actor color badges ───────────────────────────────────────────────

Deno.test("generateSetupReceipt includes actor-colored badges", () => {
  const html = generateSetupReceipt(makeInput());
  assertStringIncludes(html, "#2e7d32"); // origem green
  assertStringIncludes(html, "#1565c0"); // celula blue
  assertStringIncludes(html, "#f9a825"); // pack amber
  assertStringIncludes(html, "#00695c"); // reciclagem teal
});
