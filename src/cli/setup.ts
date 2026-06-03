/**
 * CLI: deno task setup
 *
 * Executa as Etapas 0-3 do pipeline:
 *   1. Carregar configuração do .env
 *   2. Gerar 4 carteiras de atores (mnemonics + Enterprise addresses)
 *   3. Salvar todos os 4 mnemonics e endereços no .env
 *   4. Financiar todas as 4 carteiras com uma única transação
 *   5. Aguardar confirmação do financiamento
 *   6. Imprimir resumo
 *
 * Após executar isso, use `deno task issue-origem` etc. um de cada vez.
 */

import { loadConfig } from "../config.ts";
import { openSetupReceipt } from "../reports/setup-receipt.ts";
import { appendCommentToEnv, appendToEnv } from "../state.ts";
import { fundActorWallets, waitForConfirmation } from "../transfer.ts";
import type { ActorName, ActorWallet, PipelineConfig } from "../types.ts";
import { ACTOR_ORDER } from "../types.ts";
import { createActorWallet, generateMnemonic } from "../wallet.ts";

/**
 * Ponto de entrada principal do setup.
 *
 * Executa as Etapas 0-3 do pipeline DPP:
 *   Etapa 0: Carregar e validar configuração .env
 *   Etapa 1: Gerar 4 mnemonics BIP-39, derivar Enterprise addresses,
 *            salvar todos os mnemonics e endereços no .env
 *   Etapa 2: Construir e submeter uma única tx de financiamento (4 x 50 ADA)
 *   Etapa 3: Aguardar confirmação do financiamento + buffer de 15s para propagação de UTxO
 *
 * Após a conclusão, o usuário pode emitir credenciais uma de cada vez
 * usando `deno task issue-origem`, `deno task issue-celula`, etc.
 * Este comando é o mesmo para ambos os modos de emissão (uverify e metadata).
 */
async function main(): Promise<void> {
  console.log("=".repeat(64));
  console.log("Cardano DPP Passaport — Setup (wallets + funding)");
  console.log("=".repeat(64));

  // ── ETAPA 0: Carregar configuração ──────────────────────────────────
  console.log("\n--- STEP 0: Load configuration ---");
  let config: PipelineConfig;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(
      `Configuration error: ${e instanceof Error ? e.message : e}`,
    );
    Deno.exit(1);
  }
  console.log(`Blockfrost: ${config.blockfrostProjectId.slice(0, 12)}...`);
  console.log(`UVerify:    ${config.uverifyApiUrl}`);
  console.log(
    `Mnemonic:   ${config.mainWalletMnemonic.split(" ").slice(0, 3).join(" ")}...`,
  );

  // ── ETAPA 1: Gerar 4 carteiras de atores ────────────────────────────
  console.log("\n--- STEP 1: Generate actor wallets ---");

  const blockfrostConfig = {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  };

  const ACTOR_ENV_NUMBERS: Record<ActorName, string> = {
    origem: "1",
    celula: "2",
    pack: "3",
    reciclagem: "4",
  };

  const ACTOR_DESCRIPTIONS: Record<ActorName, string> = {
    origem: "Ator 1 — Origem (MineraLitio Jequitinhonha)",
    celula: "Ator 2 — Celula (CellTech Brasil)",
    pack: "Ator 3 — Pack (PackMontadora SP)",
    reciclagem: "Ator 4 — Reciclagem (RecicLar Sorocaba)",
  };

  const wallets = {} as Record<ActorName, ActorWallet>;
  for (const name of ACTOR_ORDER) {
    const mnemonic = generateMnemonic();
    const wallet = await createActorWallet(name, mnemonic, blockfrostConfig);
    wallets[name] = wallet;

    const num = ACTOR_ENV_NUMBERS[name];

    // Salva mnemonic e endereço no .env com descrição do ator
    appendCommentToEnv(ACTOR_DESCRIPTIONS[name]);
    appendToEnv(`ATOR${num}_MNEMONIC`, mnemonic);
    appendToEnv(`ATOR${num}_ADDRESS`, wallet.address);

    console.log(`\n  ${name} (Ator ${num}):`);
    console.log(`    Address:  ${wallet.address}`);
    console.log(`    Mnemonic: ${mnemonic.split(" ").slice(0, 3).join(" ")}...`);
    console.log(`    Saved to .env: ATOR${num}_MNEMONIC, ATOR${num}_ADDRESS`);
  }

  // ── ETAPA 2: Financiar carteiras dos atores ──────────────────────────────────
  const fundingTxHash = await fundActorWallets(
    config,
    ACTOR_ORDER.map((n) => wallets[n]),
  );

  // Salva o hash da tx de financiamento
  appendToEnv("FUNDING_TX", fundingTxHash);

  // ── ETAPA 3: Aguardar confirmação do financiamento ───────────────────────
  await waitForConfirmation(config, fundingTxHash);

  // Buffer extra para propagação de UTxO.
  console.log("Waiting 15s for UTxO propagation...");
  await new Promise((r) => setTimeout(r, 15_000));

  // ── Resumo ─────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(64));
  console.log("SETUP COMPLETE");
  console.log("=".repeat(64));

  console.log(`\nFunding tx: ${fundingTxHash}`);
  console.log(
    `Cexplorer:  https://preprod.cexplorer.io/tx/${fundingTxHash}`,
  );

  console.log("\nActor Wallets:");
  for (const name of ACTOR_ORDER) {
    const w = wallets[name];
    const num = ACTOR_ENV_NUMBERS[name];
    console.log(`  Ator ${num} (${name}): ${w.address}`);
  }

  console.log("\nAll mnemonics and addresses saved to .env");
  console.log("Next step: deno task issue-origem");

  // ── Gerar recibo de setup ───────────────────────────────────────
  console.log("\nGenerating setup receipt...");
  await openSetupReceipt({
    wallets,
    fundingTxHash,
    adaPerWallet: 50,
  });
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
