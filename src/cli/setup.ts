/**
 * CLI: deno task setup
 *
 * Runs Steps 0-3 of the pipeline:
 *   1. Load config from .env
 *   2. Generate 4 actor wallets (mnemonics + Enterprise addresses)
 *   3. Save all 4 mnemonics and addresses to .env
 *   4. Fund all 4 wallets with a single transaction
 *   5. Wait for funding confirmation
 *   6. Print summary
 *
 * After running this, use `deno task issue-origem` etc. one at a time.
 */

import { loadConfig } from "../config.ts";
import { appendCommentToEnv, appendToEnv } from "../state.ts";
import { fundActorWallets, waitForConfirmation } from "../transfer.ts";
import type { ActorName, ActorWallet, PipelineConfig } from "../types.ts";
import { ACTOR_ORDER } from "../types.ts";
import { createActorWallet, generateMnemonic } from "../wallet.ts";

async function main(): Promise<void> {
  console.log("=".repeat(64));
  console.log("Cardano DPP Passaport — Setup (wallets + funding)");
  console.log("=".repeat(64));

  // ── STEP 0: Load configuration ──────────────────────────────────
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

  // ── STEP 1: Generate 4 actor wallets ────────────────────────────
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

  // Save funding tx hash
  appendToEnv("FUNDING_TX", fundingTxHash);

  // ── STEP 3: Wait for funding confirmation ───────────────────────
  await waitForConfirmation(config, fundingTxHash);

  // Extra buffer for UTxO propagation.
  console.log("Waiting 15s for UTxO propagation...");
  await new Promise((r) => setTimeout(r, 15_000));

  // ── Summary ─────────────────────────────────────────────────────
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
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
