/**
 * Direct metadata credential issuance — no smart contracts.
 *
 * Builds transactions with DPP payloads as native Cardano metadata
 * under label 1990. Only the network fee is paid; change goes back
 * to the issuing wallet. Uses the evolution-sdk Client for
 * transaction building and Blockfrost for confirmation polling.
 *
 * Analogous to the Python `emissor_direto.py` — writes the full
 * credential payload directly into the transaction metadata.
 */

import {
  TransactionHash,
  TransactionMetadatum,
} from "@evolution-sdk/evolution";
import { dataHash } from "./hash.ts";
import { PAYLOAD_BUILDERS } from "./payloads.ts";
import type { PayloadEnv } from "./payloads.ts";
import type {
  ActorName,
  ActorWallet,
  DppPayload,
  IssuanceResult,
  PipelineConfig,
} from "./types.ts";

/** Metadata label for DPP credentials (matches Python implementation). */
const METADATA_LABEL = 1990n;

/** Maximum text length for a single Cardano metadata string (64 bytes). */
const MAX_TEXT_BYTES = 64;

const MAX_ATTEMPTS = 5;
const INITIAL_DELAY_MS = 10_000;

/**
 * Split a string into chunks that fit within the 64-byte metadata text limit.
 *
 * Cardano native metadata text fields are limited to 64 bytes per the
 * ledger spec. Values longer than 64 bytes (e.g. long issuer names,
 * data hashes) must be split into an array of chunks. The verifier
 * reassembles them by joining the array elements.
 *
 * Uses a byte-aware approach: trims from the end character by character
 * until the UTF-8 encoded slice fits within 64 bytes.
 */
function chunkString(value: string): string[] {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);
  if (encoded.length <= MAX_TEXT_BYTES) return [value];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    // Start with the full remaining string, trim until it fits
    let end = value.length;
    while (end > offset) {
      const slice = value.slice(offset, end);
      if (encoder.encode(slice).length <= MAX_TEXT_BYTES) {
        chunks.push(slice);
        offset = end;
        break;
      }
      end--;
    }
  }
  return chunks;
}

/**
 * Convert a DppPayload (Record<string, string>) to a TransactionMetadatum Map.
 *
 * Handles the 64-byte text limit by chunking long values into arrays.
 * Keys are always short enough (<64 bytes) so they don't need chunking.
 */
function payloadToMetadatum(
  payload: DppPayload,
): TransactionMetadatum.Map {
  const entries: Array<[TransactionMetadatum.TransactionMetadatum, TransactionMetadatum.TransactionMetadatum]> = [];

  for (const [key, value] of Object.entries(payload)) {
    const chunks = chunkString(value);
    const metadatumValue: TransactionMetadatum.TransactionMetadatum =
      chunks.length === 1
        ? chunks[0]!
        : TransactionMetadatum.array(chunks);

    entries.push([key, metadatumValue]);
  }

  return TransactionMetadatum.fromEntries(entries);
}

/**
 * Wait for a transaction to be confirmed on-chain via Blockfrost.
 *
 * Polls GET /txs/{txHash} every 5 seconds until Blockfrost returns
 * HTTP 200 (tx is on-chain) or the timeout expires (default 90s).
 * Used for metadata-mode transactions which don't go through UVerify.
 */
async function waitForBlockfrostConfirmation(
  config: PipelineConfig,
  txHash: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(
        `${config.blockfrostBaseUrl}/txs/${txHash}`,
        {
          headers: { project_id: config.blockfrostProjectId },
          signal: AbortSignal.timeout(15_000),
        },
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
 * Issue a single credential for one actor using direct native metadata.
 *
 * Builds a metadata-only transaction (pays only the network fee; change
 * goes back to the issuing wallet) with the DPP payload under label 1990.
 */
export async function issueCredentialDireto(
  config: PipelineConfig,
  wallet: ActorWallet,
  env: PayloadEnv,
): Promise<IssuanceResult> {
  const actor = wallet.name;
  console.log(`\n  Issuing credential for ${actor} (direct metadata)...`);

  // 1. Build the DPP payload.
  const { payload, serial, gtin } = await PAYLOAD_BUILDERS[actor](env);

  // 2. Compute the data_hash (product fingerprint).
  const hash = await dataHash(gtin, serial);
  console.log(`  data_hash: ${hash}`);

  // Include data_hash in the on-chain metadata for cross-referencing.
  payload["data_hash"] = hash;

  // 3. Convert payload to TransactionMetadatum.
  const metadatumMap = payloadToMetadatum(payload);

  // 4. Build, sign, and submit with retry.
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const actorClient = wallet.client;

      const signBuilder = await actorClient
        .newTx()
        .attachMetadata({
          label: METADATA_LABEL,
          metadata: metadatumMap,
        })
        .build();

      const submitBuilder = await signBuilder.sign();
      const txHashObj = await submitBuilder.submit();
      const txHash = TransactionHash.toHex(txHashObj);

      console.log(`  tx_hash: ${txHash}`);

      // Wait for on-chain confirmation.
      console.log("  Waiting for on-chain confirmation...");
      const confirmed = await waitForBlockfrostConfirmation(config, txHash);
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

      const delay = Math.min(
        INITIAL_DELAY_MS * Math.pow(2, attempt - 1),
        60_000,
      );
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
 * Issue credentials for all 4 actors sequentially using direct metadata.
 *
 * Issuance order: origem → celula → pack → reciclagem.
 * Same sequential dependency as issueAllCredentials in issuer.ts:
 * each actor references the previous actor's txHash (ref_*_tx fields),
 * so parallel issuance is not possible. The PayloadEnv is updated after
 * each issuance with the resulting txHash so the next actor can reference it.
 *
 * Used by main.ts when EMISSION_MODE=metadata.
 */
export async function issueAllCredentialsDireto(
  config: PipelineConfig,
  wallets: Record<ActorName, ActorWallet>,
  env: PayloadEnv,
): Promise<IssuanceResult[]> {
  console.log("\n--- STEP 4: Issue credentials (direct metadata) ---");
  const results: IssuanceResult[] = [];

  // Actor 1: Origem (no references)
  const r1 = await issueCredentialDireto(config, wallets.origem, env);
  env.ator1Tx = r1.txHash;
  results.push(r1);

  // Actor 2: Celula (references Actor 1)
  const r2 = await issueCredentialDireto(config, wallets.celula, env);
  env.ator2Tx = r2.txHash;
  results.push(r2);

  // Actor 3: Pack (references Actor 2)
  const r3 = await issueCredentialDireto(config, wallets.pack, env);
  env.ator3Tx = r3.txHash;
  results.push(r3);

  // Actor 4: Reciclagem (references Actors 1, 2, 3)
  const r4 = await issueCredentialDireto(config, wallets.reciclagem, env);
  results.push(r4);

  return results;
}
