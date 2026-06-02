/**
 * 10-Student DPP Simulation — Mixed-Mode (UVerify + Direct Metadata)
 *
 * Runs 10 independent DPP supply chain pipelines. Each student gets:
 *   - 4 actor wallets (origem, celula, pack, reciclagem)
 *   - 20 ADA per wallet (80 ADA per student, 800 ADA total)
 *   - 4 credentials issued sequentially, alternating between UVerify
 *     and direct metadata mode per actor position
 *
 * Mode assignment:
 *   Odd students (1,3,5,7,9):  origem=metadata, celula=uverify, pack=metadata, reciclagem=uverify
 *   Even students (2,4,6,8,10): origem=uverify, celula=metadata, pack=uverify, reciclagem=metadata
 *
 * After issuance, all students are verified at both pack and reciclagem entry points.
 *
 * Funding is batched (5 students per tx to stay within tx size limits).
 * Credential issuance runs in parallel across students (concurrency = 5).
 *
 * Uses the main wallet (WALLET_MNEMONIC) for funding all 40 wallets.
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

const NUM_STUDENTS = 10;
const ADA_PER_WALLET = 20;
const STUDENTS_PER_FUNDING_TX = 5;
const ISSUANCE_CONCURRENCY = 5;

/** Extended issuance result that tracks which mode was used. */
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

interface VerificationResult {
  studentId: number;
  entryPoint: "pack" | "reciclagem";
  passed: boolean;
  error?: string;
}

/**
 * Get the emission mode for each actor based on student parity.
 *
 * Odd students (1,3,5,7,9):  origem=metadata, celula=uverify, pack=metadata, reciclagem=uverify
 * Even students (2,4,6,8,10): origem=uverify, celula=metadata, pack=uverify, reciclagem=metadata
 */
function getModeMap(studentId: number): Record<ActorName, EmissionMode> {
  const isOdd = studentId % 2 === 1;
  return {
    origem: isOdd ? "metadata" : "uverify",
    celula: isOdd ? "uverify" : "metadata",
    pack: isOdd ? "metadata" : "uverify",
    reciclagem: isOdd ? "uverify" : "metadata",
  };
}

/**
 * Issue all 4 credentials for one student using mixed modes.
 *
 * Each actor is issued sequentially (env dependency chain), but the
 * mode alternates between UVerify and direct metadata per actor.
 */
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

  // Actor 1: Origem (no references)
  const r1 = modeMap.origem === "metadata"
    ? await issueCredentialDireto(config, wallets.origem, env)
    : await issueCredential(config, wallets.origem, env);
  env.ator1Tx = r1.txHash;
  results.push({ ...r1, mode: modeMap.origem });

  // Actor 2: Celula (references Actor 1)
  const r2 = modeMap.celula === "metadata"
    ? await issueCredentialDireto(config, wallets.celula, env)
    : await issueCredential(config, wallets.celula, env);
  env.ator2Tx = r2.txHash;
  results.push({ ...r2, mode: modeMap.celula });

  // Actor 3: Pack (references Actor 2)
  const r3 = modeMap.pack === "metadata"
    ? await issueCredentialDireto(config, wallets.pack, env)
    : await issueCredential(config, wallets.pack, env);
  env.ator3Tx = r3.txHash;
  results.push({ ...r3, mode: modeMap.pack });

  // Actor 4: Reciclagem (references Actors 1, 2, 3)
  const r4 = modeMap.reciclagem === "metadata"
    ? await issueCredentialDireto(config, wallets.reciclagem, env)
    : await issueCredential(config, wallets.reciclagem, env);
  results.push({ ...r4, mode: modeMap.reciclagem });

  return results;
}

/**
 * Run a single student's credential issuance pipeline.
 * Assumes wallets are already funded.
 */
async function issueStudentCredentials(
  student: StudentSetup,
  config: PipelineConfig,
): Promise<MixedIssuanceResult[]> {
  const env: PayloadEnv = { suffix: student.suffix };

  console.log(
    `  [Student ${student.studentId}] Issuing 4 credentials in mixed mode (suffix: ${student.suffix})...`,
  );
  const credentials = await issueAllCredentialsMixed(
    config,
    student.wallets,
    env,
    student.studentId,
  );
  console.log(`  [Student ${student.studentId}] DONE — all 4 credentials issued.`);

  return credentials;
}

/**
 * Run tasks in parallel with a concurrency limit.
 */
async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * PHASE 4: Verify all students at both pack and reciclagem entry points.
 */
async function verifyAllStudents(
  config: PipelineConfig,
  results: StudentResult[],
): Promise<VerificationResult[]> {
  const verificationResults: VerificationResult[] = [];

  for (const student of results) {
    // Find pack credential (index 2) and reciclagem credential (index 3)
    const packCred = student.credentials.find((c) => c.actor === "pack");
    const reciclagemCred = student.credentials.find((c) => c.actor === "reciclagem");

    // Verify from pack entry point
    if (packCred) {
      console.log(`\n${"#".repeat(64)}`);
      console.log(`### Student ${student.studentId} — Pack Verification ###`);
      console.log(`${"#".repeat(64)}`);
      try {
        await verifyChain(config, packCred.dataHash, packCred.txHash);
        verificationResults.push({
          studentId: student.studentId,
          entryPoint: "pack",
          passed: true,
        });
        console.log(`\n>>> Student ${student.studentId} (pack): PASSED <<<`);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        verificationResults.push({
          studentId: student.studentId,
          entryPoint: "pack",
          passed: false,
          error,
        });
        console.error(`\n>>> Student ${student.studentId} (pack): FAILED — ${error} <<<`);
      }
    }

    // Verify from reciclagem entry point
    if (reciclagemCred) {
      console.log(`\n${"#".repeat(64)}`);
      console.log(`### Student ${student.studentId} — Reciclagem Verification ###`);
      console.log(`${"#".repeat(64)}`);
      try {
        await verifyChain(config, reciclagemCred.dataHash, reciclagemCred.txHash);
        verificationResults.push({
          studentId: student.studentId,
          entryPoint: "reciclagem",
          passed: true,
        });
        console.log(`\n>>> Student ${student.studentId} (reciclagem): PASSED <<<`);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        verificationResults.push({
          studentId: student.studentId,
          entryPoint: "reciclagem",
          passed: false,
          error,
        });
        console.error(
          `\n>>> Student ${student.studentId} (reciclagem): FAILED — ${error} <<<`,
        );
      }
    }
  }

  return verificationResults;
}

/**
 * Print the full simulation summary.
 */
function printSimulationSummary(
  results: StudentResult[],
  verificationResults?: VerificationResult[],
): void {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`SIMULATION COMPLETE — ${results.length} Students (mixed mode: UVerify + metadata)`);
  console.log("=".repeat(80));

  for (const r of results) {
    console.log(`\n--- Student ${r.studentId} (${(r.durationMs / 1000).toFixed(0)}s) ---`);
    console.log(`  Funding tx: ${r.fundingTxHash}`);

    console.log("  Credentials:");
    for (const c of r.credentials) {
      console.log(`    ${c.actor} [${c.mode}]:`);
      console.log(`      tx_hash:   ${c.txHash}`);
      console.log(`      data_hash: ${c.dataHash}`);
      console.log(`      Cexplorer: https://preprod.cexplorer.io/tx/${c.txHash}`);
    }
  }

  // Compact summary table
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

  // Verification summary
  if (verificationResults && verificationResults.length > 0) {
    const passedCount = verificationResults.filter((v) => v.passed).length;
    const failedCount = verificationResults.filter((v) => !v.passed).length;

    console.log(`\n${"=".repeat(80)}`);
    console.log("VERIFICATION SUMMARY");
    console.log("=".repeat(80));
    console.log(
      `${"Student".padEnd(10)} ${"Entry Point".padEnd(14)} ${"Result".padEnd(10)} Error`,
    );
    console.log("-".repeat(80));
    for (const v of verificationResults) {
      const status = v.passed ? "PASSED" : "FAILED";
      console.log(
        `${String(v.studentId).padEnd(10)} ${v.entryPoint.padEnd(14)} ${status.padEnd(10)} ${v.error ?? ""}`,
      );
    }
    console.log("-".repeat(80));
    console.log(`Total: ${passedCount} passed, ${failedCount} failed out of ${verificationResults.length}`);
    console.log("=".repeat(80));
  }
}

/**
 * Main entry point: simulate 10 students with mixed-mode issuance + dual verification.
 */
async function main(): Promise<void> {
  const totalAda = NUM_STUDENTS * 4 * ADA_PER_WALLET;
  console.log("=".repeat(80));
  console.log(`Cardano DPP — ${NUM_STUDENTS}-Student Mixed-Mode Simulation (UVerify + metadata)`);
  console.log(`${NUM_STUDENTS} students x 4 actors x ${ADA_PER_WALLET} ADA = ${totalAda} ADA total`);
  console.log("=".repeat(80));

  // Load configuration.
  let config: PipelineConfig;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(`Configuration error: ${e instanceof Error ? e.message : e}`);
    Deno.exit(1);
  }

  console.log(`Blockfrost: ${config.blockfrostProjectId.slice(0, 12)}...`);
  console.log(`Mode:       mixed (UVerify + direct native metadata)`);
  console.log(`Concurrency: ${ISSUANCE_CONCURRENCY} students in parallel`);
  console.log(`Mnemonic:   ${config.mainWalletMnemonic.split(" ").slice(0, 3).join(" ")}...`);

  const blockfrostConfig = {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  };

  // ── PHASE 1: Generate all 40 wallets ────────────────────────────
  console.log(`\n${"=".repeat(80)}`);
  console.log("PHASE 1: Generate wallets");
  console.log("=".repeat(80));

  const students: StudentSetup[] = [];
  for (let i = 1; i <= NUM_STUDENTS; i++) {
    const wallets = {} as Record<ActorName, ActorWallet>;
    for (const name of ACTOR_ORDER) {
      const mnemonic = generateMnemonic();
      const wallet = await createActorWallet(name, mnemonic, blockfrostConfig);
      wallets[name] = wallet;
    }
    const suffix = await mnemonicSuffix(wallets.origem.mnemonic);
    students.push({ studentId: i, wallets, suffix });
    console.log(`  Student ${String(i).padStart(2)}: wallets generated (suffix: ${suffix})`);
  }

  // ── PHASE 2: Fund all wallets in batches ────────────────────────
  console.log(`\n${"=".repeat(80)}`);
  console.log("PHASE 2: Fund wallets");
  console.log("=".repeat(80));

  const numBatches = Math.ceil(NUM_STUDENTS / STUDENTS_PER_FUNDING_TX);
  const fundingTxMap = new Map<number, string>(); // studentId -> fundingTxHash

  for (let batch = 0; batch < numBatches; batch++) {
    const batchStart = batch * STUDENTS_PER_FUNDING_TX;
    const batchStudents = students.slice(batchStart, batchStart + STUDENTS_PER_FUNDING_TX);
    const batchIds = batchStudents.map((s) => s.studentId);

    // Collect all wallets from this batch into a single funding tx.
    const allWallets: ActorWallet[] = [];
    for (const student of batchStudents) {
      for (const name of ACTOR_ORDER) {
        allWallets.push(student.wallets[name]);
      }
    }

    const batchAda = allWallets.length * ADA_PER_WALLET;
    console.log(
      `\n  Batch ${batch + 1}/${numBatches}: Students [${batchIds.join(", ")}] — ` +
        `${allWallets.length} wallets x ${ADA_PER_WALLET} ADA = ${batchAda} ADA`,
    );

    // Retry funding up to 3 times (Blockfrost UTXO cache may lag).
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

    for (const student of batchStudents) {
      fundingTxMap.set(student.studentId, fundingTxHash);
    }

    // Wait for this batch's funding to confirm before building the next tx
    // (needed because the main wallet's change UTXO must be available).
    await waitForConfirmation(config, fundingTxHash);

    // Extra buffer so Blockfrost's UTXO index updates for the next batch.
    if (batch < numBatches - 1) {
      console.log(`  Batch ${batch + 1} confirmed. Waiting 20s for UTXO propagation...`);
      await new Promise((r) => setTimeout(r, 20_000));
    } else {
      console.log(`  Batch ${batch + 1} confirmed.`);
    }
  }

  // Extra buffer for UTxO propagation.
  console.log("\nWaiting 15s for UTxO propagation...");
  await new Promise((r) => setTimeout(r, 15_000));

  // ── PHASE 3: Issue credentials in parallel (mixed mode) ─────────
  console.log(`\n${"=".repeat(80)}`);
  console.log(`PHASE 3: Issue credentials — mixed mode (${ISSUANCE_CONCURRENCY} students in parallel)`);
  console.log("=".repeat(80));

  const startTime = Date.now();

  const rawResults = await parallelMap(
    students,
    ISSUANCE_CONCURRENCY,
    async (student): Promise<StudentResult | null> => {
      const t0 = Date.now();
      try {
        const credentials = await issueStudentCredentials(student, config);
        return {
          studentId: student.studentId,
          wallets: student.wallets,
          fundingTxHash: fundingTxMap.get(student.studentId) ?? "",
          credentials,
          durationMs: Date.now() - t0,
        };
      } catch (e) {
        console.error(
          `\n  STUDENT ${student.studentId} FAILED: ${e instanceof Error ? e.message : e}`,
        );
        return null;
      }
    },
  );

  const totalDuration = Date.now() - startTime;
  const results = rawResults.filter((r): r is StudentResult => r !== null);

  console.log(`\n${results.length}/${NUM_STUDENTS} students completed issuance.`);
  if (results.length < NUM_STUDENTS) {
    console.log(`${NUM_STUDENTS - results.length} students failed issuance.`);
  }
  console.log(`Total issuance phase: ${(totalDuration / 1000).toFixed(0)}s`);
  console.log(
    `Credentials issued: ${results.length * 4} (${results.length} students x 4 actors)`,
  );

  // ── PHASE 4: Verify all students at pack and reciclagem ─────────
  let verificationResults: VerificationResult[] = [];
  if (results.length > 0) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(
      `PHASE 4: Verify all ${results.length} students at pack + reciclagem entry points`,
    );
    console.log("=".repeat(80));

    verificationResults = await verifyAllStudents(config, results);
  }

  // ── PHASE 5: Final Summary ──────────────────────────────────────
  if (results.length > 0) {
    printSimulationSummary(results, verificationResults);
  }
}

// Run the simulation.
main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
