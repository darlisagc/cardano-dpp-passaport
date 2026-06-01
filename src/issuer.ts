/**
 * UVerify credential issuance logic.
 *
 * Issues DPP credentials for each actor using the UVerify JS SDK.
 * Uses the low-level core.buildTransaction() + core.submitTransaction()
 * flow for full control over custom ref_*_tx fields.
 *
 * Includes automatic retries with increasing intervals for transient API errors.
 */

import { UVerifyClient } from "@uverify/sdk";
import { dataHash } from "./hash.ts";
import { PAYLOAD_BUILDERS } from "./payloads.ts";
import type { PayloadEnv } from "./payloads.ts";
import type {
  ActorName,
  ActorWallet,
  IssuanceResult,
  PipelineConfig,
} from "./types.ts";

const MAX_ATTEMPTS = 5;
const INITIAL_DELAY_MS = 40_000;

/**
 * Wait for a UVerify transaction to be confirmed on-chain.
 */
async function waitForUVerifyConfirmation(
  baseUrl: string,
  txHash: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(
        `${baseUrl}/api/v1/transaction/confirm/${txHash}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (resp.ok) return true;
    } catch {
      // Network error — retry
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

/**
 * Poll the collateral endpoint until the UTxO is confirmed available.
 * Returns as soon as collateral is ready, or after timeoutMs (default 60s).
 */
async function waitForCollateralReady(
  baseUrl: string,
  address: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5_000));
    try {
      const resp = await fetch(
        `${baseUrl}/api/v1/transaction/prepare-collateral`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ senderAddress: address }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      const status = data?.status?.message?.toUpperCase?.() ?? "";
      if (status.includes("COLLATERAL_ALREADY_AVAILABLE")) {
        console.log("  Collateral confirmed ready.");
        return;
      }
      if (!data?.unsignedTransaction) {
        // No tx needed — collateral exists
        console.log("  Collateral ready (no action needed).");
        return;
      }
    } catch {
      // Network error — retry
    }
  }
  console.log("  WARNING: Collateral readiness timeout — proceeding anyway.");
}

/**
 * Prepare collateral UTXO (>= 5 ADA) for Plutus V3 scripts.
 *
 * Uses a direct fetch for the collateral-specific endpoint (no SDK method),
 * but delegates submission to the UVerify SDK's core.submitTransaction()
 * for proper error handling and serialization.
 */
async function prepareCollateral(
  baseUrl: string,
  address: string,
  signTx: (tx: string) => Promise<string>,
  client?: InstanceType<typeof UVerifyClient>,
): Promise<void> {
  console.log("  [collateral] Checking collateral...");

  // --- Step 1: Check / request collateral via the dedicated endpoint ---
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/api/v1/transaction/prepare-collateral`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderAddress: address }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.log(`  [collateral] Request failed: ${e}`);
    return;
  }

  if (!resp.ok) {
    console.log(
      `  [collateral] API returned ${resp.status} — proceeding without dedicated collateral.`,
    );
    return;
  }

  let data: Record<string, unknown>;
  try {
    data = await resp.json();
  } catch {
    console.log("  [collateral] Invalid JSON response — proceeding.");
    return;
  }

  const statusMsg: string =
    (data?.status as Record<string, unknown>)?.message?.toString?.().toUpperCase?.() ?? "";

  if (statusMsg.includes("COLLATERAL_ALREADY_AVAILABLE")) {
    console.log("  [collateral] Already available.");
    return;
  }

  const unsignedTx: string | undefined = typeof data?.unsignedTransaction === "string"
    ? data.unsignedTransaction as string
    : undefined;
  if (!unsignedTx) {
    console.log("  [collateral] No action needed.");
    return;
  }

  // --- Step 2: Sign & submit ---
  console.log("  [collateral] Creating collateral UTXO (5 ADA)...");
  const witnessSet = await signTx(unsignedTx);

  try {
    let collateralTxHash: string | undefined;

    if (client) {
      // Use the SDK's submitTransaction for proper error handling.
      collateralTxHash = await client.core.submitTransaction(
        unsignedTx,
        witnessSet,
      );
    } else {
      // Fallback to raw fetch when no client is provided.
      const submitResp = await fetch(`${baseUrl}/api/v1/transaction/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unsignedTransaction: unsignedTx, witnessSet }),
        signal: AbortSignal.timeout(30_000),
      });
      if (submitResp.ok) {
        const submitData = await submitResp.json();
        collateralTxHash = submitData?.txHash ?? submitData?.transactionHash;
      }
    }

    if (collateralTxHash) {
      console.log(
        `  [collateral] Tx submitted: ${collateralTxHash.slice(0, 16)}...`,
      );
      await waitForUVerifyConfirmation(baseUrl, collateralTxHash);
      console.log("  [collateral] Confirmed.");
    } else {
      console.log("  [collateral] Tx submitted (no hash returned), polling for readiness...");
      await waitForCollateralReady(baseUrl, address);
    }
  } catch (e) {
    console.log(`  [collateral] Submit failed (${e}), polling for readiness...`);
    await waitForCollateralReady(baseUrl, address);
  }
}

/**
 * Issue a single credential for one actor.
 *
 * Uses UVerify's core.buildTransaction() + core.submitTransaction()
 * for full control over the payload (including ref_*_tx fields).
 */
export async function issueCredential(
  config: PipelineConfig,
  wallet: ActorWallet,
  env: PayloadEnv,
): Promise<IssuanceResult> {
  const actor = wallet.name;
  console.log(`\n  Issuing credential for ${actor}...`);

  // 1. Build the DPP payload.
  const { payload, serial, gtin } = await PAYLOAD_BUILDERS[actor](env);

  // 2. Compute the data_hash (product fingerprint).
  const hash = await dataHash(gtin, serial);
  console.log(`  data_hash: ${hash}`);

  // 3. Create UVerify client with this actor's signing callbacks.
  const client = new UVerifyClient({
    baseUrl: config.uverifyApiUrl,
    signTx: wallet.signTx,
    signMessage: wallet.signMessage,
  });

  // 4. Prepare collateral for Plutus V3 scripts (pass client for SDK submission).
  await prepareCollateral(config.uverifyApiUrl, wallet.address, wallet.signTx, client);

  // Poll until collateral UTxO has settled.
  console.log("  Polling for collateral readiness...");
  await waitForCollateralReady(config.uverifyApiUrl, wallet.address);

  // 5. Issue with retry and exponential backoff.
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Build the certificate issuance transaction.
      const buildResult = await client.core.buildTransaction({
        type: "default",
        address: wallet.address,
        certificates: [
          {
            hash,
            algorithm: "SHA-256",
            metadata: payload,
          },
        ],
      });

      // Check for status codes that need handling.
      const statusMsg = (buildResult.status?.message ?? "").toUpperCase();

      if (statusMsg.includes("COLLATERAL") && statusMsg.includes("REQUIRED")) {
        console.log("  Status: COLLATERAL_REQUIRED — preparing...");
        await prepareCollateral(
          config.uverifyApiUrl,
          wallet.address,
          wallet.signTx,
          client,
        );
        await waitForCollateralReady(config.uverifyApiUrl, wallet.address);
        continue;
      }

      if (statusMsg.includes("PENDING")) {
        console.log("  Status: PENDING_TRANSACTION — waiting...");
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }

      // Sign the unsigned transaction.
      const unsignedTx = buildResult.unsignedTransaction;
      if (!unsignedTx) {
        throw new Error(
          `buildTransaction returned no unsignedTransaction (status: ${buildResult.status?.message ?? "unknown"})`,
        );
      }
      const witnessSet = await wallet.signTx(unsignedTx);

      // Submit the signed transaction.
      const txHash = await client.core.submitTransaction(
        unsignedTx,
        witnessSet,
      );

      console.log(`  tx_hash: ${txHash}`);

      // Wait for on-chain confirmation before returning.
      console.log("  Waiting for on-chain confirmation...");
      const confirmed = await waitForUVerifyConfirmation(
        config.uverifyApiUrl,
        txHash,
      );
      if (confirmed) {
        console.log("  Confirmed on-chain.");
      } else {
        console.log("  WARNING: Timeout waiting for confirmation — proceeding.");
      }

      return { actor, txHash, dataHash: hash };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      // Fatal: no UTXOs — wallet is empty.
      if (lastError.message.toLowerCase().includes("no utxos found")) {
        throw lastError;
      }

      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
      if (attempt < MAX_ATTEMPTS) {
        console.log(
          `  Attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastError.message}), ` +
            `retrying in ${delay / 1000}s...`,
        );
        await new Promise((r) => setTimeout(r, delay));
      } else {
        console.log(`  All ${MAX_ATTEMPTS} attempts failed.`);
      }
    }
  }

  throw lastError ?? new Error(`Failed to issue credential for ${actor}`);
}

/**
 * Issue credentials for all 4 actors sequentially.
 *
 * Each actor references the previous actor's txHash, so parallel
 * issuance is not possible. The env is updated after each issuance.
 */
export async function issueAllCredentials(
  config: PipelineConfig,
  wallets: Record<ActorName, ActorWallet>,
  env: PayloadEnv,
): Promise<IssuanceResult[]> {
  console.log("\n--- STEP 4: Issue credentials ---");
  const results: IssuanceResult[] = [];

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
