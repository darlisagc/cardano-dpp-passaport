/**
 * Retry script for Students 8 and 9 — Mixed-Mode
 *
 * Runs only 2 students sequentially (concurrency=1) to avoid
 * UVerify API overload that caused the original failures.
 *
 * Mode assignment (same as main simulation):
 *   Student 8 (even): origem=uverify, celula=metadata, pack=uverify, reciclagem=metadata
 *   Student 9 (odd):  origem=metadata, celula=uverify, pack=metadata, reciclagem=uverify
 */

import { loadConfig } from "./config.ts";
import { issueCredential } from "./issuer.ts";
import { issueCredentialDireto } from "./issuer-direto.ts";
import { verifyChain } from "./verify.ts";
import type { PayloadEnv } from "./payloads.ts";
import { fundActorWallets, waitForConfirmation } from "./transfer.ts";
import type { ActorName, ActorWallet, EmissionMode, IssuanceResult, PipelineConfig } from "./types.ts";
import { ACTOR_ORDER } from "./types.ts";
import { createActorWallet, generateMnemonic } from "./wallet.ts";
import { mnemonicSuffix } from "./hash.ts";

const ADA_PER_WALLET = 20;

interface MixedIssuanceResult extends IssuanceResult {
  mode: EmissionMode;
}

interface StudentSetup {
  studentId: number;
  wallets: Record<ActorName, ActorWallet>;
  suffix: string;
}

interface StudentResult {
  studentId: number;
  wallets: Record<ActorName, ActorWallet>;
  fundingTxHash: string;
  credentials: MixedIssuanceResult[];
  durationMs: number;
}

function getModeMap(studentId: number): Record<ActorName, EmissionMode> {
  const isOdd = studentId % 2 === 1;
  return {
    origem: isOdd ? "metadata" : "uverify",
    celula: isOdd ? "uverify" : "metadata",
    pack: isOdd ? "metadata" : "uverify",
    reciclagem: isOdd ? "uverify" : "metadata",
  };
}

async function issueAllCredentialsMixed(
  config: PipelineConfig,
  wallets: Record<ActorName, ActorWallet>,
  env: PayloadEnv,
  studentId: number,
): Promise<MixedIssuanceResult[]> {
  const modeMap = getModeMap(studentId);
  const results: MixedIssuanceResult[] = [];

  console.log(`\n--- [Student ${studentId}] Issue credentials (mixed mode) ---`);
  console.log(
    `  Modes: origem=${modeMap.origem}, celula=${modeMap.celula}, ` +
      `pack=${modeMap.pack}, reciclagem=${modeMap.reciclagem}`,
  );

  const r1 = modeMap.origem === "metadata"
    ? await issueCredentialDireto(config, wallets.origem, env)
    : await issueCredential(config, wallets.origem, env);
  env.ator1Tx = r1.txHash;
  results.push({ ...r1, mode: modeMap.origem });

  const r2 = modeMap.celula === "metadata"
    ? await issueCredentialDireto(config, wallets.celula, env)
    : await issueCredential(config, wallets.celula, env);
  env.ator2Tx = r2.txHash;
  results.push({ ...r2, mode: modeMap.celula });

  const r3 = modeMap.pack === "metadata"
    ? await issueCredentialDireto(config, wallets.pack, env)
    : await issueCredential(config, wallets.pack, env);
  env.ator3Tx = r3.txHash;
  results.push({ ...r3, mode: modeMap.pack });

  const r4 = modeMap.reciclagem === "metadata"
    ? await issueCredentialDireto(config, wallets.reciclagem, env)
    : await issueCredential(config, wallets.reciclagem, env);
  results.push({ ...r4, mode: modeMap.reciclagem });

  return results;
}

async function main(): Promise<void> {
  const studentIds = [8, 9];
  const totalAda = studentIds.length * 4 * ADA_PER_WALLET;

  console.log("=".repeat(80));
  console.log(`Cardano DPP — Retry Students ${studentIds.join(", ")} (mixed mode, sequential)`);
  console.log(`${studentIds.length} students x 4 actors x ${ADA_PER_WALLET} ADA = ${totalAda} ADA total`);
  console.log("=".repeat(80));

  let config: PipelineConfig;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(`Configuration error: ${e instanceof Error ? e.message : e}`);
    Deno.exit(1);
  }

  console.log(`Blockfrost: ${config.blockfrostProjectId.slice(0, 12)}...`);
  console.log(`Mode:       mixed (UVerify + metadata) — sequential to avoid API overload`);
  console.log(`Mnemonic:   ${config.mainWalletMnemonic.split(" ").slice(0, 3).join(" ")}...`);

  const blockfrostConfig = {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  };

  // ── PHASE 1: Generate wallets ───────────────────────────────────
  console.log(`\n${"=".repeat(80)}`);
  console.log("PHASE 1: Generate wallets");
  console.log("=".repeat(80));

  const students: StudentSetup[] = [];
  for (const id of studentIds) {
    const wallets = {} as Record<ActorName, ActorWallet>;
    for (const name of ACTOR_ORDER) {
      const mnemonic = generateMnemonic();
      const wallet = await createActorWallet(name, mnemonic, blockfrostConfig);
      wallets[name] = wallet;
    }
    const suffix = await mnemonicSuffix(wallets.origem.mnemonic);
    students.push({ studentId: id, wallets, suffix });
    console.log(`  Student ${id}: wallets generated (suffix: ${suffix})`);
  }

  // ── PHASE 2: Fund all wallets in a single batch ─────────────────
  console.log(`\n${"=".repeat(80)}`);
  console.log("PHASE 2: Fund wallets");
  console.log("=".repeat(80));

  const allWallets: ActorWallet[] = [];
  for (const student of students) {
    for (const name of ACTOR_ORDER) {
      allWallets.push(student.wallets[name]);
    }
  }

  const batchAda = allWallets.length * ADA_PER_WALLET;
  console.log(`\n  Single batch: ${allWallets.length} wallets x ${ADA_PER_WALLET} ADA = ${batchAda} ADA`);

  let fundingTxHash = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fundingTxHash = await fundActorWallets(config, allWallets, ADA_PER_WALLET);
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < 3) {
        console.log(`  Funding attempt ${attempt}/3 failed (${msg.slice(0, 80)}), waiting 30s...`);
        await new Promise((r) => setTimeout(r, 30_000));
      } else {
        throw e;
      }
    }
  }

  await waitForConfirmation(config, fundingTxHash);
  console.log(`  Funding confirmed: ${fundingTxHash}`);

  console.log("\nWaiting 15s for UTxO propagation...");
  await new Promise((r) => setTimeout(r, 15_000));

  // ── PHASE 3: Issue credentials SEQUENTIALLY (one student at a time) ──
  console.log(`\n${"=".repeat(80)}`);
  console.log("PHASE 3: Issue credentials — sequential (1 student at a time)");
  console.log("=".repeat(80));

  const startTime = Date.now();
  const results: StudentResult[] = [];

  for (const student of students) {
    const t0 = Date.now();
    console.log(`\n  [Student ${student.studentId}] Starting issuance (suffix: ${student.suffix})...`);

    try {
      const env: PayloadEnv = { suffix: student.suffix };
      const credentials = await issueAllCredentialsMixed(
        config,
        student.wallets,
        env,
        student.studentId,
      );
      results.push({
        studentId: student.studentId,
        wallets: student.wallets,
        fundingTxHash,
        credentials,
        durationMs: Date.now() - t0,
      });
      console.log(`  [Student ${student.studentId}] DONE — all 4 credentials issued.`);
    } catch (e) {
      console.error(
        `\n  STUDENT ${student.studentId} FAILED: ${e instanceof Error ? e.message : e}`,
      );
    }

    // 10s buffer between students to let UVerify API settle
    if (student !== students[students.length - 1]) {
      console.log("\n  Waiting 10s before next student...");
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  const totalDuration = Date.now() - startTime;

  console.log(`\n${results.length}/${studentIds.length} students completed issuance.`);
  console.log(`Total issuance phase: ${(totalDuration / 1000).toFixed(0)}s`);
  console.log(`Credentials issued: ${results.length * 4}`);

  // ── PHASE 4: Verify at both entry points ────────────────────────
  if (results.length > 0) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`PHASE 4: Verify ${results.length} students at pack + reciclagem`);
    console.log("=".repeat(80));

    let passed = 0;
    let failed = 0;

    for (const student of results) {
      const packCred = student.credentials.find((c) => c.actor === "pack");
      const reciclagemCred = student.credentials.find((c) => c.actor === "reciclagem");

      if (packCred) {
        console.log(`\n${"#".repeat(64)}`);
        console.log(`### Student ${student.studentId} — Pack Verification ###`);
        console.log(`${"#".repeat(64)}`);
        try {
          await verifyChain(config, packCred.dataHash, packCred.txHash);
          passed++;
          console.log(`\n>>> Student ${student.studentId} (pack): PASSED <<<`);
        } catch (e) {
          failed++;
          console.error(`\n>>> Student ${student.studentId} (pack): FAILED — ${e instanceof Error ? e.message : e} <<<`);
        }
      }

      if (reciclagemCred) {
        console.log(`\n${"#".repeat(64)}`);
        console.log(`### Student ${student.studentId} — Reciclagem Verification ###`);
        console.log(`${"#".repeat(64)}`);
        try {
          await verifyChain(config, reciclagemCred.dataHash, reciclagemCred.txHash);
          passed++;
          console.log(`\n>>> Student ${student.studentId} (reciclagem): PASSED <<<`);
        } catch (e) {
          failed++;
          console.error(`\n>>> Student ${student.studentId} (reciclagem): FAILED — ${e instanceof Error ? e.message : e} <<<`);
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────────
    console.log(`\n${"=".repeat(80)}`);
    console.log(`RETRY COMPLETE — Students ${studentIds.join(", ")}`);
    console.log("=".repeat(80));

    for (const r of results) {
      console.log(`\n--- Student ${r.studentId} (${(r.durationMs / 1000).toFixed(0)}s) ---`);
      console.log(`  Funding tx: ${r.fundingTxHash}`);
      for (const c of r.credentials) {
        console.log(`    ${c.actor} [${c.mode}]:`);
        console.log(`      tx_hash:   ${c.txHash}`);
        console.log(`      data_hash: ${c.dataHash}`);
        console.log(`      Cexplorer: https://preprod.cexplorer.io/tx/${c.txHash}`);
      }
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("Summary table:");
    console.log(
      `${"Student".padEnd(10)} ${"Actor".padEnd(12)} ${"Mode".padEnd(10)} ` +
        `${"TX Hash".padEnd(66)} Data Hash`,
    );
    console.log("-".repeat(170));
    for (const r of results) {
      for (const c of r.credentials) {
        console.log(
          `${String(r.studentId).padEnd(10)} ${c.actor.padEnd(12)} ${c.mode.padEnd(10)} ` +
            `${c.txHash.padEnd(66)} ${c.dataHash}`,
        );
      }
    }
    console.log("=".repeat(80));
    console.log(`\nVerification: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  }
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
