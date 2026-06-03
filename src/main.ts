/**
 * Orquestrador do pipeline completo — executa o fluxo completo da cadeia de suprimentos DPP.
 *
 * ETAPA 0: Carregar configuração .env (mnemonic da carteira principal, chave Blockfrost)
 * ETAPA 1: Gerar 4 novas carteiras de atores (imprimir mnemonics + endereços)
 * ETAPA 2: Transferir 50 ADA para cada carteira de ator (uma única tx, 4 saídas)
 * ETAPA 3: Aguardar confirmação do financiamento
 * ETAPA 4: Emitir credenciais sequencialmente (origem → celula → pack → reciclagem)
 * ETAPA 5: Imprimir resumo com hashes de tx, links Cexplorer, URLs de verificação UVerify
 */

import { loadConfig } from "./config.ts";
import { issueAllCredentialsDireto } from "./issuer-direto.ts";
import { issueAllCredentials } from "./issuer.ts";
import { buildPayloadEnv, PAYLOAD_BUILDERS } from "./payloads.ts";
import { openEmissionReceipt } from "./reports/emission-receipt.ts";
import { openReciclagemReport } from "./reports/reciclagem-report.ts";
import { openSetupReceipt } from "./reports/setup-receipt.ts";
import { appendCommentToEnv, appendToEnv } from "./state.ts";
import { fundActorWallets, waitForConfirmation } from "./transfer.ts";
import type { ActorName, ActorWallet, IssuanceResult, PipelineConfig } from "./types.ts";
import { ACTOR_ENV_KEY, ACTOR_ORDER } from "./types.ts";
import { createActorWallet, generateMnemonic } from "./wallet.ts";

/**
 * Imprime o resumo final do pipeline no console.
 *
 * Exibe o modo de emissão, tx de financiamento com link Cexplorer, todos os
 * endereços das carteiras dos atores, e cada credencial emitida (tx_hash, data_hash,
 * link Cexplorer). No modo UVerify, também imprime a URL de verificação UVerify.
 */
function printSummary(
  results: IssuanceResult[],
  wallets: Record<ActorName, ActorWallet>,
  fundingTxHash: string,
  config: PipelineConfig,
): void {
  console.log("\n" + "=".repeat(64));
  console.log("PIPELINE COMPLETE — Summary");
  console.log("=".repeat(64));

  console.log(`\nEmission mode: ${config.emissionMode}`);
  console.log(`Funding tx: ${fundingTxHash}`);
  console.log(
    `Cexplorer:  https://preprod.cexplorer.io/tx/${fundingTxHash}`,
  );

  console.log("\nActor Wallets:");
  for (const name of ACTOR_ORDER) {
    const w = wallets[name];
    console.log(`  ${name}: ${w.address}`);
  }

  console.log("\nIssued Credentials:");
  if (config.emissionMode === "metadata") {
    for (const r of results) {
      console.log(`\n  ${r.actor}:`);
      console.log(`    tx_hash:   ${r.txHash}`);
      console.log(`    data_hash: ${r.dataHash}`);
      console.log(
        `    Cexplorer: https://preprod.cexplorer.io/tx/${r.txHash}`,
      );
    }
  } else {
    // Converte a URL da API para a URL do web app para links de verificação.
    const appUrl = config.uverifyApiUrl
      .replace("api.preprod.", "app.preprod.")
      .replace("/api/v1", "");
    for (const r of results) {
      console.log(`\n  ${r.actor}:`);
      console.log(`    tx_hash:   ${r.txHash}`);
      console.log(`    data_hash: ${r.dataHash}`);
      console.log(
        `    Cexplorer: https://preprod.cexplorer.io/tx/${r.txHash}`,
      );
      console.log(`    Verify:    ${appUrl}/verify/${r.dataHash}`);
    }
  }

  console.log("\n" + "=".repeat(64));
}

/**
 * Ponto de entrada principal do pipeline — executa o fluxo completo da cadeia de suprimentos DPP.
 *
 * Executa 6 etapas sequencialmente:
 *   Etapa 0: Carregar e validar configuração .env (chave Blockfrost, mnemonic, modo de emissão)
 *   Etapa 1: Gerar 4 carteiras de atores (mnemonics BIP-39 + Enterprise addresses)
 *   Etapa 2: Financiar todas as 4 carteiras em uma única tx (4 x 50 ADA = 200 ADA)
 *   Etapa 3: Aguardar confirmação do financiamento + buffer de 15s para propagação de UTxO
 *   Etapa 4: Emitir credenciais sequencialmente (origem → celula → pack → reciclagem)
 *            Modo selecionado por EMISSION_MODE: "uverify" usa issuer.ts, "metadata" usa issuer-direto.ts
 *   Etapa 5: Salvar todos os resultados no .env e imprimir resumo com links Cexplorer
 *
 * Ponto de entrada para `deno task run` (uverify) e `deno task run-metadata` (metadata).
 */
async function main(): Promise<void> {
  // ── ETAPA 0: Carregar configuração ──────────────────────────────────
  console.log("=".repeat(64));
  console.log("Cardano DPP Passaport — Full Pipeline");
  console.log("=".repeat(64));

  console.log("\n--- STEP 0: Load configuration ---");
  let config: PipelineConfig;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(`Configuration error: ${e instanceof Error ? e.message : e}`);
    Deno.exit(1);
  }
  console.log(`Blockfrost: ${config.blockfrostProjectId.slice(0, 12)}...`);
  console.log(`UVerify:    ${config.uverifyApiUrl}`);
  console.log(`Mode:       ${config.emissionMode}`);
  console.log(`Mnemonic:   ${config.mainWalletMnemonic.split(" ").slice(0, 3).join(" ")}...`);

  // ── ETAPA 1: Gerar 4 carteiras de atores ────────────────────────────
  console.log("\n--- STEP 1: Generate actor wallets ---");

  const blockfrostConfig = {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  };

  const ACTOR_NUMBERS: Record<ActorName, string> = {
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

    const num = ACTOR_NUMBERS[name];

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

  // Salva o hash da tx de financiamento no .env
  appendToEnv("FUNDING_TX", fundingTxHash);

  // ── ETAPA 3: Aguardar confirmação do financiamento ───────────────────────
  await waitForConfirmation(config, fundingTxHash);

  // Buffer extra para propagação de UTxO.
  console.log("Waiting 15s for UTxO propagation...");
  await new Promise((r) => setTimeout(r, 15_000));

  // Gera o recibo de setup.
  console.log("\nGenerating setup receipt...");
  await openSetupReceipt({
    wallets,
    fundingTxHash,
    adaPerWallet: 50,
  });

  // ── ETAPA 4: Emitir credenciais sequencialmente ──────────────────────
  const env = await buildPayloadEnv(config.mainWalletMnemonic);
  const results = config.emissionMode === "metadata"
    ? await issueAllCredentialsDireto(config, wallets, env)
    : await issueAllCredentials(config, wallets, env);

  // ── ETAPA 5: Salvar resultados no .env ────────────────────────────────
  for (const r of results) {
    const num = ACTOR_NUMBERS[r.actor];
    const txKey = ACTOR_ENV_KEY[r.actor];
    appendToEnv(txKey, r.txHash);
    appendToEnv(`DATA_HASH_ATOR${num}`, r.dataHash);
  }

  // Salva TX_HASH_PACK e DATA_HASH_PACK (usados pelo verify).
  const packResult = results.find((r) => r.actor === "pack");
  if (packResult) {
    appendToEnv("TX_HASH_PACK", packResult.txHash);
    appendToEnv("DATA_HASH_PACK", packResult.dataHash);
  }

  console.log("\nAll results saved to .env");

  // Gera recibos de emissão para todos os atores.
  console.log("\nGenerating emission receipts...");
  for (const r of results) {
    const receiptPayload = (await PAYLOAD_BUILDERS[r.actor](env)).payload;
    await openEmissionReceipt({
      actor: r.actor,
      payload: receiptPayload,
      txHash: r.txHash,
      dataHash: r.dataHash,
    });
    // Para reciclagem, também gera o relatório de reciclagem.
    if (r.actor === "reciclagem") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await openReciclagemReport({
        payload: receiptPayload,
        txHash: r.txHash,
        dataHash: r.dataHash,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // ── ETAPA 6: Imprimir resumo ───────────────────────────────────────
  printSummary(results, wallets, fundingTxHash, config);
}

// Executa o pipeline.
main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
