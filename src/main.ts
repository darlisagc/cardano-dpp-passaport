/**
 * Full pipeline orchestrator — runs the complete DPP supply chain flow.
 *
 * STEP 0: Load .env config (main wallet mnemonic, Blockfrost key)
 * STEP 1: Generate 4 new actor wallets (print mnemonics + addresses)
 * STEP 2: Transfer 50 ADA to each actor wallet (single tx, 4 outputs)
 * STEP 3: Wait for funding confirmation
 * STEP 4: Issue credentials sequentially (origem → celula → pack → reciclagem)
 * STEP 5: Print summary with tx hashes, Cexplorer links, UVerify verify URLs
 */

import { loadConfig } from "./config.ts";
import { issueAllCredentialsDireto } from "./issuer-direto.ts";
import { issueAllCredentials } from "./issuer.ts";
import { buildPayloadEnv } from "./payloads.ts";
import { appendCommentToEnv, appendToEnv } from "./state.ts";
import { fundActorWallets, waitForConfirmation } from "./transfer.ts";
import type { ActorName, ActorWallet, IssuanceResult, PipelineConfig } from "./types.ts";
import { ACTOR_ENV_KEY, ACTOR_ORDER } from "./types.ts";
import { createActorWallet, generateMnemonic } from "./wallet.ts";

/**
 * Print the final pipeline summary.
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
    // Convert API URL to the web app URL for verification links.
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
 * Main pipeline entry point.
 */
async function main(): Promise<void> {
  // ── STEP 0: Load configuration ──────────────────────────────────
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

  // ── STEP 1: Generate 4 actor wallets ────────────────────────────
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

    // Save mnemonic and address to .env with actor description
    appendCommentToEnv(ACTOR_DESCRIPTIONS[name]);
    appendToEnv(`ATOR${num}_MNEMONIC`, mnemonic);
    appendToEnv(`ATOR${num}_ADDRESS`, wallet.address);

    console.log(`\n  ${name} (Ator ${num}):`);
    console.log(`    Address:  ${wallet.address}`);
    console.log(`    Mnemonic: ${mnemonic.split(" ").slice(0, 3).join(" ")}...`);
    console.log(`    Saved to .env: ATOR${num}_MNEMONIC, ATOR${num}_ADDRESS`);
  }

  // ── STEP 2: Fund actor wallets ──────────────────────────────────
  const fundingTxHash = await fundActorWallets(
    config,
    ACTOR_ORDER.map((n) => wallets[n]),
  );

  // Save funding tx hash to .env
  appendToEnv("FUNDING_TX", fundingTxHash);

  // ── STEP 3: Wait for funding confirmation ───────────────────────
  await waitForConfirmation(config, fundingTxHash);

  // Extra buffer for UTxO propagation.
  console.log("Waiting 15s for UTxO propagation...");
  await new Promise((r) => setTimeout(r, 15_000));

  // ── STEP 4: Issue credentials sequentially ──────────────────────
  const env = await buildPayloadEnv(config.mainWalletMnemonic);
  const results = config.emissionMode === "metadata"
    ? await issueAllCredentialsDireto(config, wallets, env)
    : await issueAllCredentials(config, wallets, env);

  // ── STEP 5: Save results to .env ────────────────────────────────
  for (const r of results) {
    const num = ACTOR_NUMBERS[r.actor];
    const txKey = ACTOR_ENV_KEY[r.actor];
    appendToEnv(txKey, r.txHash);
    appendToEnv(`DATA_HASH_ATOR${num}`, r.dataHash);
  }

  // Save TX_HASH_PACK and DATA_HASH_PACK (used by verify).
  const packResult = results.find((r) => r.actor === "pack");
  if (packResult) {
    appendToEnv("TX_HASH_PACK", packResult.txHash);
    appendToEnv("DATA_HASH_PACK", packResult.dataHash);
  }

  console.log("\nAll results saved to .env");

  // ── STEP 6: Print summary ───────────────────────────────────────
  printSummary(results, wallets, fundingTxHash, config);
}

// Run the pipeline.
main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
