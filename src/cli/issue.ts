/**
 * CLI: deno task issue-<actor>
 *
 * Issues a single actor's credential, reading prerequisites from .env
 * and saving results back to .env.
 *
 * Usage:
 *   deno task issue-origem       # Actor 1 — no prerequisites
 *   deno task issue-celula       # Actor 2 — requires ATOR1_TX in .env
 *   deno task issue-pack         # Actor 3 — requires ATOR2_TX in .env
 *   deno task issue-reciclagem   # Actor 4 — requires ATOR1_TX, ATOR2_TX, ATOR3_TX
 */

import { loadConfig } from "../config.ts";
import { issueCredentialDireto } from "../issuer-direto.ts";
import { issueCredential } from "../issuer.ts";
import { buildPayloadEnv } from "../payloads.ts";
import type { PayloadEnv } from "../payloads.ts";
import { appendToEnv, readEnvVar } from "../state.ts";
import type { ActorName } from "../types.ts";
import { ACTOR_ENV_KEY } from "../types.ts";
import { createActorWallet } from "../wallet.ts";

/** Map actor name → actor number for .env variable naming. */
const ACTOR_NUMBERS: Record<ActorName, string> = {
  origem: "1",
  celula: "2",
  pack: "3",
  reciclagem: "4",
};

/** Prerequisites: which ATOR*_TX vars must exist before issuing each actor. */
const PREREQUISITES: Record<ActorName, string[]> = {
  origem: [],
  celula: ["ATOR1_TX"],
  pack: ["ATOR2_TX"],
  reciclagem: ["ATOR1_TX", "ATOR2_TX", "ATOR3_TX"],
};

/** Friendly names for the next step hint. */
const NEXT_STEP: Record<ActorName, string> = {
  origem: "deno task issue-celula",
  celula: "deno task issue-pack",
  pack: "deno task issue-reciclagem",
  reciclagem: "deno task verify",
};

const VALID_ACTORS: ActorName[] = ["origem", "celula", "pack", "reciclagem"];

function usage(): never {
  console.error("Usage: deno task issue-<actor>");
  console.error("  Actors: origem, celula, pack, reciclagem");
  console.error("");
  console.error("Examples:");
  console.error("  deno task issue-origem");
  console.error("  deno task issue-celula");
  Deno.exit(1);
}

async function main(): Promise<void> {
  // ── Parse actor name from CLI args ────────────────────────────
  const actorArg = Deno.args[0]?.trim().toLowerCase();
  if (!actorArg || !VALID_ACTORS.includes(actorArg as ActorName)) {
    console.error(`Error: Invalid or missing actor name: "${actorArg}"`);
    usage();
  }
  const actor = actorArg as ActorName;
  const num = ACTOR_NUMBERS[actor];

  console.log("=".repeat(64));
  console.log(`Cardano DPP Passaport — Issue credential: ${actor} (Ator ${num})`);
  console.log("=".repeat(64));

  // ── Load configuration ────────────────────────────────────────
  console.log("\nLoading configuration...");
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(
      `Configuration error: ${e instanceof Error ? e.message : e}`,
    );
    Deno.exit(1);
  }

  // ── Check prerequisites ───────────────────────────────────────
  const prereqs = PREREQUISITES[actor];
  for (const key of prereqs) {
    const val = readEnvVar(key);
    if (!val) {
      console.error(`\nError: ${key} is not set in .env`);
      console.error(
        `You must issue the previous actor's credential first.`,
      );
      console.error("Run the steps in order:");
      console.error("  1. deno task setup");
      console.error("  2. deno task issue-origem");
      console.error("  3. deno task issue-celula");
      console.error("  4. deno task issue-pack");
      console.error("  5. deno task issue-reciclagem");
      Deno.exit(1);
    }
  }

  // ── Load actor mnemonic from .env ─────────────────────────────
  const mnemonicKey = `ATOR${num}_MNEMONIC`;
  const mnemonic = readEnvVar(mnemonicKey);
  if (!mnemonic) {
    console.error(`\nError: ${mnemonicKey} is not set in .env`);
    console.error("Run 'deno task setup' first to generate actor wallets.");
    Deno.exit(1);
  }

  // ── Recreate the actor's wallet from stored mnemonic ──────────
  console.log(`\nRecreating wallet for ${actor} from stored mnemonic...`);
  const blockfrostConfig = {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  };
  const wallet = await createActorWallet(actor, mnemonic, blockfrostConfig);
  console.log(`  Address: ${wallet.address}`);

  // ── Build PayloadEnv from stored tx hashes ────────────────────
  const env: PayloadEnv = await buildPayloadEnv(config.mainWalletMnemonic);

  // Load previously issued tx hashes into the env.
  const ator1Tx = readEnvVar("ATOR1_TX");
  const ator2Tx = readEnvVar("ATOR2_TX");
  const ator3Tx = readEnvVar("ATOR3_TX");
  if (ator1Tx) env.ator1Tx = ator1Tx;
  if (ator2Tx) env.ator2Tx = ator2Tx;
  if (ator3Tx) env.ator3Tx = ator3Tx;

  // ── Issue the credential ──────────────────────────────────────
  const result = config.emissionMode === "metadata"
    ? await issueCredentialDireto(config, wallet, env)
    : await issueCredential(config, wallet, env);

  // ── Save results to .env ──────────────────────────────────────
  const txKey = ACTOR_ENV_KEY[actor];
  appendToEnv(txKey, result.txHash);
  appendToEnv(`DATA_HASH_ATOR${num}`, result.dataHash);

  // For pack, also save TX_HASH_PACK and DATA_HASH_PACK (used by verify).
  if (actor === "pack") {
    appendToEnv("TX_HASH_PACK", result.txHash);
    appendToEnv("DATA_HASH_PACK", result.dataHash);
  }

  // ── Print result ──────────────────────────────────────────────
  console.log("\n" + "=".repeat(64));
  console.log(`CREDENTIAL ISSUED — ${actor} (Ator ${num}) [${config.emissionMode}]`);
  console.log("=".repeat(64));
  console.log(`  tx_hash:   ${result.txHash}`);
  console.log(`  data_hash: ${result.dataHash}`);
  console.log(
    `  Cexplorer: https://preprod.cexplorer.io/tx/${result.txHash}`,
  );
  if (config.emissionMode === "uverify") {
    const appUrl = config.uverifyApiUrl
      .replace("api.preprod.", "app.preprod.")
      .replace("/api/v1", "");
    console.log(`  Verify:    ${appUrl}/verify/${result.dataHash}`);
  }
  console.log(`\n  Saved to .env: ${txKey}=${result.txHash}`);
  console.log(`  Saved to .env: DATA_HASH_ATOR${num}=${result.dataHash}`);
  if (actor === "pack") {
    console.log(`  Saved to .env: TX_HASH_PACK=${result.txHash}`);
    console.log(`  Saved to .env: DATA_HASH_PACK=${result.dataHash}`);
  }
  console.log(`\nNext step: ${NEXT_STEP[actor]}`);
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
