/**
 * Test Chain with 2 Users — UVerify Only
 *
 * Runs the full DPP supply chain pipeline for 2 independent users on
 * Cardano preprod testnet using UVerify smart contracts only.
 *
 * Each user gets:
 *   - 4 actor wallets (origem, celula, pack, reciclagem)
 *   - 20 ADA per wallet (80 ADA per user, 160 ADA total + fees)
 *   - 4 credentials issued sequentially (origem → celula → pack → reciclagem)
 *
 * Users are processed sequentially to avoid collateral UTXO contention
 * on the UVerify contract.
 *
 * After issuance, chain verification runs from both pack and reciclagem
 * entry points for each user.
 */

import { loadConfig } from "./config.ts";
import { mnemonicSuffix } from "./hash.ts";
import { issueCredential } from "./issuer.ts";
import type { PayloadEnv } from "./payloads.ts";
import { fundActorWallets, waitForConfirmation } from "./transfer.ts";
import type {
  ActorName,
  ActorWallet,
  IssuanceResult,
  PipelineConfig,
} from "./types.ts";
import { ACTOR_ORDER } from "./types.ts";
import { verifyChain } from "./verify.ts";
import { createActorWallet, generateMnemonic } from "./wallet.ts";

const NUM_USERS = 2;
const ADA_PER_WALLET = 20;

interface UserSetup {
  userId: number;
  wallets: Record<ActorName, ActorWallet>;
  suffix: string;
}

interface UserResult {
  userId: number;
  wallets: Record<ActorName, ActorWallet>;
  fundingTxHash: string;
  credentials: IssuanceResult[];
}

interface VerificationResult {
  userId: number;
  entryPoint: "pack" | "reciclagem";
  passed: boolean;
  error?: string;
}

/**
 * Issue all 4 credentials for one user sequentially (UVerify only).
 */
async function issueUserCredentials(
  config: PipelineConfig,
  wallets: Record<ActorName, ActorWallet>,
  suffix: string,
  userId: number,
): Promise<IssuanceResult[]> {
  const env: PayloadEnv = { suffix };
  const results: IssuanceResult[] = [];

  console.log(`\n--- [User ${userId}] Issue credentials (UVerify) ---`);

  // Actor 1: Origem (no references)
  const r1 = await issueCredential(config, wallets.origem, env);
  env.ator1Tx = r1.txHash;
  results.push(r1);

  // Actor 2: Celula (references Actor 1)
  const r2 = await issueCredential(config, wallets.celula, env);
  env.ator2Tx = r2.txHash;
  results.push(r2);

  // Actor 3: Pack (references Actor 2)
  const r3 = await issueCredential(config, wallets.pack, env);
  env.ator3Tx = r3.txHash;
  results.push(r3);

  // Actor 4: Reciclagem (references Actors 1, 2, 3)
  const r4 = await issueCredential(config, wallets.reciclagem, env);
  results.push(r4);

  return results;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const totalAda = NUM_USERS * 4 * ADA_PER_WALLET;
  console.log("=".repeat(64));
  console.log(`Cardano DPP — ${NUM_USERS}-User Test (UVerify Only)`);
  console.log(
    `${NUM_USERS} users x 4 actors x ${ADA_PER_WALLET} ADA = ${totalAda} ADA total`,
  );
  console.log("=".repeat(64));

  // Load configuration.
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
  console.log(`Mode:       UVerify only`);
  console.log(
    `Mnemonic:   ${config.mainWalletMnemonic.split(" ").slice(0, 3).join(" ")}...`,
  );

  const blockfrostConfig = {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  };

  // ── PHASE 1: Generate wallets ──────────────────────────────────
  console.log(`\n${"=".repeat(64)}`);
  console.log("PHASE 1: Generate wallets");
  console.log("=".repeat(64));

  const users: UserSetup[] = [];
  for (let i = 1; i <= NUM_USERS; i++) {
    const wallets = {} as Record<ActorName, ActorWallet>;
    for (const name of ACTOR_ORDER) {
      const mnemonic = generateMnemonic();
      const wallet = await createActorWallet(name, mnemonic, blockfrostConfig);
      wallets[name] = wallet;
    }
    const suffix = await mnemonicSuffix(wallets.origem.mnemonic);
    users.push({ userId: i, wallets, suffix });
    console.log(`  User ${i}: wallets generated (suffix: ${suffix})`);
    for (const name of ACTOR_ORDER) {
      console.log(`    ${name}: ${wallets[name].address}`);
    }
  }

  console.log(`\n  Total: ${NUM_USERS * 4} wallets generated.`);

  // ── PHASE 2: Fund wallets ──────────────────────────────────────
  console.log(`\n${"=".repeat(64)}`);
  console.log("PHASE 2: Fund wallets");
  console.log("=".repeat(64));

  const fundingTxMap = new Map<number, string>();

  for (let i = 0; i < users.length; i++) {
    const user = users[i]!;
    const allWallets: ActorWallet[] = ACTOR_ORDER.map(
      (name) => user.wallets[name],
    );

    console.log(
      `\n  User ${user.userId}: ${allWallets.length} wallets x ${ADA_PER_WALLET} ADA = ${allWallets.length * ADA_PER_WALLET} ADA`,
    );

    // Retry funding up to 3 times.
    let fundingTxHash = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        fundingTxHash = await fundActorWallets(
          config,
          allWallets,
          ADA_PER_WALLET,
        );
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < 3) {
          console.log(
            `  Funding attempt ${attempt}/3 failed (${msg.slice(0, 80)}), waiting 30s...`,
          );
          await new Promise((r) => setTimeout(r, 30_000));
        } else {
          throw e;
        }
      }
    }

    fundingTxMap.set(user.userId, fundingTxHash);

    // Wait for confirmation.
    await waitForConfirmation(config, fundingTxHash);

    // Wait for UTxO propagation before next user's funding tx.
    if (i < users.length - 1) {
      console.log("  Waiting 15s for UTxO propagation...");
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }

  // Extra buffer for UTxO propagation before issuance.
  console.log("\nWaiting 15s for UTxO propagation...");
  await new Promise((r) => setTimeout(r, 15_000));

  // ── PHASE 3: Issue credentials (sequential per user) ───────────
  console.log(`\n${"=".repeat(64)}`);
  console.log("PHASE 3: Issue credentials (sequential, UVerify only)");
  console.log("=".repeat(64));

  const results: UserResult[] = [];

  for (const user of users) {
    console.log(`\n>>> User ${user.userId} — starting issuance <<<`);
    try {
      const credentials = await issueUserCredentials(
        config,
        user.wallets,
        user.suffix,
        user.userId,
      );
      results.push({
        userId: user.userId,
        wallets: user.wallets,
        fundingTxHash: fundingTxMap.get(user.userId) ?? "",
        credentials,
      });
      console.log(
        `\n>>> User ${user.userId} — all 4 credentials issued <<<`,
      );
    } catch (e) {
      console.error(
        `\n>>> User ${user.userId} FAILED: ${e instanceof Error ? e.message : e} <<<`,
      );
    }
  }

  console.log(
    `\n${results.length}/${NUM_USERS} users completed issuance.`,
  );

  // ── PHASE 4: Verify chains ────────────────────────────────────
  const verificationResults: VerificationResult[] = [];

  if (results.length > 0) {
    console.log(`\n${"=".repeat(64)}`);
    console.log("PHASE 4: Verify chains (pack + reciclagem per user)");
    console.log("=".repeat(64));

    for (const user of results) {
      const packCred = user.credentials.find((c) => c.actor === "pack");
      const reciclagemCred = user.credentials.find(
        (c) => c.actor === "reciclagem",
      );

      // Verify from pack entry point
      if (packCred) {
        console.log(`\n${"#".repeat(64)}`);
        console.log(`### User ${user.userId} — Pack Verification ###`);
        console.log(`${"#".repeat(64)}`);
        try {
          await verifyChain(config, packCred.dataHash, packCred.txHash);
          verificationResults.push({
            userId: user.userId,
            entryPoint: "pack",
            passed: true,
          });
          console.log(`\n>>> User ${user.userId} (pack): PASSED <<<`);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          verificationResults.push({
            userId: user.userId,
            entryPoint: "pack",
            passed: false,
            error,
          });
          console.error(
            `\n>>> User ${user.userId} (pack): FAILED — ${error} <<<`,
          );
        }
      }

      // Verify from reciclagem entry point
      if (reciclagemCred) {
        console.log(`\n${"#".repeat(64)}`);
        console.log(
          `### User ${user.userId} — Reciclagem Verification ###`,
        );
        console.log(`${"#".repeat(64)}`);
        try {
          await verifyChain(
            config,
            reciclagemCred.dataHash,
            reciclagemCred.txHash,
          );
          verificationResults.push({
            userId: user.userId,
            entryPoint: "reciclagem",
            passed: true,
          });
          console.log(
            `\n>>> User ${user.userId} (reciclagem): PASSED <<<`,
          );
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          verificationResults.push({
            userId: user.userId,
            entryPoint: "reciclagem",
            passed: false,
            error,
          });
          console.error(
            `\n>>> User ${user.userId} (reciclagem): FAILED — ${error} <<<`,
          );
        }
      }
    }
  }

  // ── PHASE 5: Summary ──────────────────────────────────────────
  if (results.length > 0) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(
      `TEST COMPLETE — ${results.length} Users (UVerify Only)`,
    );
    console.log("=".repeat(80));

    for (const r of results) {
      console.log(`\n--- User ${r.userId} ---`);
      console.log(
        `  Funding tx: https://preprod.cexplorer.io/tx/${r.fundingTxHash}`,
      );
      console.log("  Credentials:");
      for (const c of r.credentials) {
        console.log(`    ${c.actor}:`);
        console.log(`      tx_hash:   ${c.txHash}`);
        console.log(`      data_hash: ${c.dataHash}`);
        console.log(
          `      Cexplorer: https://preprod.cexplorer.io/tx/${c.txHash}`,
        );
        console.log(
          `      UVerify:   https://preprod.uverify.io/verify/${c.dataHash}`,
        );
      }
    }

    // Compact summary table
    console.log(`\n${"=".repeat(80)}`);
    console.log("Summary table:");
    console.log(
      `${"User".padEnd(6)} ${"Actor".padEnd(12)} ` +
        `${"TX Hash".padEnd(66)} Data Hash`,
    );
    console.log("-".repeat(150));
    for (const r of results) {
      for (const c of r.credentials) {
        console.log(
          `${String(r.userId).padEnd(6)} ${c.actor.padEnd(12)} ` +
            `${c.txHash.padEnd(66)} ${c.dataHash}`,
        );
      }
    }
    console.log("=".repeat(150));

    // Verification summary
    if (verificationResults.length > 0) {
      const passedCount = verificationResults.filter((v) => v.passed).length;
      const failedCount = verificationResults.filter((v) => !v.passed).length;

      console.log(`\n${"=".repeat(80)}`);
      console.log("VERIFICATION SUMMARY");
      console.log("=".repeat(80));
      console.log(
        `${"User".padEnd(6)} ${"Entry Point".padEnd(14)} ${"Result".padEnd(10)} Error`,
      );
      console.log("-".repeat(80));
      for (const v of verificationResults) {
        const status = v.passed ? "PASSED" : "FAILED";
        console.log(
          `${String(v.userId).padEnd(6)} ${v.entryPoint.padEnd(14)} ${status.padEnd(10)} ${v.error ?? ""}`,
        );
      }
      console.log("-".repeat(80));
      console.log(
        `Total: ${passedCount} passed, ${failedCount} failed out of ${verificationResults.length}`,
      );
      console.log("=".repeat(80));
    }
  }
}

// Run the test.
main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
