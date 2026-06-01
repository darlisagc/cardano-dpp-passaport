/**
 * ADA transfer from the main wallet to 4 actor wallets.
 *
 * Builds a single transaction with 4 outputs (50 ADA each = 200 ADA total)
 * using the evolution-sdk Client. Single tx is faster and avoids UTxO
 * chaining issues.
 */

import { Address, Assets, TransactionHash } from "@evolution-sdk/evolution";
import { createMainWalletClient, getClientAddress } from "./wallet.ts";
import type { ActorWallet, PipelineConfig } from "./types.ts";

/** Default amount to send to each actor wallet (50 ADA = 50,000,000 lovelace). */
const DEFAULT_FUNDING_LOVELACE = 50_000_000n;

/**
 * Fund actor wallets from the main wallet in a single transaction.
 *
 * Creates an evolution-sdk Client for the main wallet, then builds a
 * single Cardano transaction with one output per actor wallet (default
 * 50 ADA each = 200 ADA total). Using a single tx with multiple outputs
 * is faster than individual transfers and avoids UTxO chaining issues.
 *
 * The tx is built → signed → submitted via the evolution-sdk pipeline.
 *
 * @param adaPerWallet — ADA to send per wallet (default 50).
 * @returns The transaction hash of the funding tx.
 */
export async function fundActorWallets(
  config: PipelineConfig,
  actorWallets: ActorWallet[],
  adaPerWallet = 50,
): Promise<string> {
  const lovelacePerWallet = adaPerWallet > 0
    ? BigInt(adaPerWallet) * 1_000_000n
    : DEFAULT_FUNDING_LOVELACE;

  const totalAda = actorWallets.length * adaPerWallet;
  console.log("\n--- Fund actor wallets ---");
  console.log(
    `Sending ${actorWallets.length} x ${adaPerWallet} ADA = ${totalAda} ADA total`,
  );

  // Create evolution-sdk client with the main wallet.
  const client = createMainWalletClient(config.mainWalletMnemonic, {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  });

  const mainAddress = await getClientAddress(client);
  console.log(`Main wallet: ${mainAddress}`);

  // Build a single transaction with outputs.
  const txBuilder = client.newTx();

  for (const wallet of actorWallets) {
    txBuilder.payToAddress({
      address: Address.fromBech32(wallet.address),
      assets: Assets.fromLovelace(lovelacePerWallet),
    });
    console.log(`  → ${wallet.name}: ${wallet.address} (${adaPerWallet} ADA)`);
  }

  // Build → Sign → Submit
  const signBuilder = await txBuilder.build();
  const submitBuilder = await signBuilder.sign();
  const txHashObj = await submitBuilder.submit();
  const txHash = TransactionHash.toHex(txHashObj);

  console.log(`\nFunding tx submitted: ${txHash}`);
  console.log(`Cexplorer: https://preprod.cexplorer.io/tx/${txHash}`);

  return txHash;
}

/**
 * Wait for a transaction to be confirmed on-chain.
 *
 * Polls the Blockfrost API (GET /txs/{txHash}) every 5 seconds until
 * the tx appears on-chain (HTTP 200) or the timeout expires (default 120s).
 * Used after the funding transaction to ensure actor wallets have ADA
 * before attempting credential issuance.
 */
export async function waitForConfirmation(
  config: PipelineConfig,
  txHash: string,
  timeoutMs = 120_000,
): Promise<boolean> {
  console.log(`\n--- STEP 3: Waiting for funding confirmation ---`);
  const start = Date.now();
  const pollInterval = 5_000;

  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(
        `${config.blockfrostBaseUrl}/txs/${txHash}`,
        {
          headers: { project_id: config.blockfrostProjectId },
        },
      );
      if (resp.ok) {
        console.log("Funding tx confirmed on-chain.");
        return true;
      }
    } catch {
      // Network error — retry
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  console.log("WARNING: Timeout waiting for funding confirmation — proceeding anyway.");
  return false;
}
