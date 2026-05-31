/**
 * Chain verification — verifies each credential and walks the chain
 * backward from pack (or reciclagem) to origin.
 *
 * Supports two verification paths:
 *   1. UVerify API (GET /api/v1/verify/{dataHash}) — for uverify-issued credentials
 *   2. Blockfrost metadata (GET /txs/{txHash}/metadata) — for direct metadata credentials
 *
 * When a tx_hash is known, Blockfrost metadata is tried first (works for
 * both modes), falling back to UVerify API.
 */

import type { PipelineConfig } from "./types.ts";

/** Credential data extracted from verification response. */
interface VerifiedCredential {
  name?: string;
  issuer?: string;
  gtin?: string;
  origin?: string;
  manufactured?: string;
  carbonFootprint?: string;
  recycledContent?: string;
  materials: Record<string, string>;
  references: Record<string, string>; // ref_*_tx fields
  dataHashes: Record<string, string>; // ref_*_data_hash fields
  txHash?: string;
}

/**
 * Classify metadata fields by naming convention.
 */
function classifyFields(
  meta: Record<string, string>,
): {
  references: Record<string, string>;
  dataHashes: Record<string, string>;
  materials: Record<string, string>;
} {
  const references: Record<string, string> = {};
  const dataHashes: Record<string, string> = {};
  const materials: Record<string, string> = {};

  for (const [key, value] of Object.entries(meta)) {
    if (key.startsWith("ref_") && key.endsWith("_tx")) {
      // ref_origem_tx → references["origem_tx"]
      references[key.slice(4)] = value;
    } else if (key.startsWith("ref_") && key.endsWith("_data_hash")) {
      // ref_origem_data_hash → dataHashes["origem_data_hash"]
      dataHashes[key.slice(4)] = value;
    } else if (key.startsWith("mat_")) {
      materials[key] = value;
    }
  }

  return { references, dataHashes, materials };
}

/**
 * Convert a Blockfrost metadata value (which may be a string or array of
 * strings for chunked values) back to a plain string.
 */
function metadatumToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(metadatumToString).join("");
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return String(value);
}

/**
 * Parse a Blockfrost metadata JSON object (from /txs/{hash}/metadata)
 * into a flat Record<string, string>.
 *
 * Blockfrost returns metadata as:
 *   [{ label: "1990", json_metadata: { key: value, ... } }]
 *
 * For TransactionMetadatum Maps, json_metadata is an object where keys
 * are strings and values are strings or arrays (chunked text).
 */
function parseBlockfrostMetadata(
  metadataArray: Array<{ label: string; json_metadata: unknown }>,
): Record<string, string> | null {
  // Find our label (1990)
  const entry = metadataArray.find((m) => m.label === "1990");
  if (!entry || !entry.json_metadata) return null;

  const jsonMeta = entry.json_metadata;
  if (typeof jsonMeta !== "object" || jsonMeta === null) return null;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(jsonMeta as Record<string, unknown>)) {
    result[key] = metadatumToString(value);
  }
  return result;
}

/**
 * Verify a credential by fetching native metadata from Blockfrost.
 * Works for direct-metadata-issued credentials (label 1990).
 */
async function verifyByBlockfrostMetadata(
  config: PipelineConfig,
  txHash: string,
): Promise<VerifiedCredential | null> {
  try {
    const resp = await fetch(
      `${config.blockfrostBaseUrl}/txs/${txHash}/metadata`,
      {
        headers: { project_id: config.blockfrostProjectId },
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!resp.ok) return null;

    const metadataArray = await resp.json();
    if (!Array.isArray(metadataArray) || metadataArray.length === 0) {
      return null;
    }

    const meta = parseBlockfrostMetadata(metadataArray);
    if (!meta) return null;

    const { references, dataHashes, materials } = classifyFields(meta);

    return {
      name: meta.name,
      issuer: meta.issuer,
      gtin: meta.gtin,
      origin: meta.origin,
      manufactured: meta.manufactured,
      carbonFootprint: meta.carbon_footprint,
      recycledContent: meta.recycled_content,
      materials,
      references,
      dataHashes,
      txHash,
    };
  } catch {
    return null;
  }
}

/**
 * Look up a credential on UVerify by data_hash.
 * Optionally filter by tx_hash for exact match.
 */
async function verifyByDataHash(
  baseUrl: string,
  dHash: string,
  txHash?: string,
): Promise<VerifiedCredential> {
  const resp = await fetch(`${baseUrl}/api/v1/verify/${dHash}`, {
    signal: AbortSignal.timeout(30_000),
  });

  if (resp.status === 404) {
    throw new Error(`Credential not found for data_hash: ${dHash}`);
  }
  if (!resp.ok) {
    throw new Error(`UVerify API error ${resp.status}: ${await resp.text()}`);
  }

  const items = await resp.json();
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Empty response for data_hash: ${dHash}`);
  }

  // Find exact tx match, or use first item as fallback.
  let match = items[0];
  if (txHash) {
    const exact = items.find(
      (item: Record<string, unknown>) =>
        item.transactionHash === txHash,
    );
    if (exact) match = exact;
  }

  // Parse metadata.
  let meta: Record<string, string>;
  const rawMeta = match.metadata;
  if (typeof rawMeta === "string") {
    meta = JSON.parse(rawMeta);
  } else {
    meta = rawMeta ?? {};
  }

  const { references, dataHashes, materials } = classifyFields(meta);

  return {
    name: meta.name,
    issuer: meta.issuer,
    gtin: meta.gtin,
    origin: meta.origin,
    manufactured: meta.manufactured,
    carbonFootprint: meta.carbon_footprint,
    recycledContent: meta.recycled_content,
    materials,
    references,
    dataHashes,
    txHash: match.transactionHash ?? txHash,
  };
}

/**
 * Look up a credential using dual-path verification.
 *
 * When a tx_hash is available, tries Blockfrost native metadata first
 * (works for both direct-metadata and UVerify-issued credentials that
 * happen to have label 1990). Falls back to UVerify API.
 */
async function verifyCredential(
  config: PipelineConfig,
  dHash?: string,
  txHash?: string,
): Promise<VerifiedCredential> {
  // Try Blockfrost metadata first when we have a tx_hash.
  if (txHash) {
    const bfResult = await verifyByBlockfrostMetadata(config, txHash);
    if (bfResult) {
      console.log("  (verified via Blockfrost metadata)");
      return bfResult;
    }
  }

  // Fall back to UVerify API (requires data_hash).
  if (dHash) {
    const uvResult = await verifyByDataHash(
      config.uverifyApiUrl,
      dHash,
      txHash,
    );
    console.log("  (verified via UVerify API)");
    return uvResult;
  }

  throw new Error(
    "Cannot verify: need at least a data_hash or tx_hash",
  );
}

/**
 * Print a verified credential summary.
 */
function printCredential(label: string, cred: VerifiedCredential): void {
  console.log(`\n  ${label}:`);
  console.log(`    Name:     ${cred.name ?? "N/A"}`);
  console.log(`    Issuer:   ${cred.issuer ?? "N/A"}`);
  console.log(`    Origin:   ${cred.origin ?? "N/A"}`);
  console.log(`    GTIN:     ${cred.gtin ?? "N/A"}`);
  console.log(`    Date:     ${cred.manufactured ?? "N/A"}`);
  console.log(`    CO2:      ${cred.carbonFootprint ?? "N/A"}`);
  if (Object.keys(cred.materials).length > 0) {
    console.log(`    Materials:`);
    for (const [k, v] of Object.entries(cred.materials)) {
      console.log(`      ${k}: ${v}`);
    }
  }
  if (cred.txHash) {
    console.log(
      `    Cexplorer: https://preprod.cexplorer.io/tx/${cred.txHash}`,
    );
  }
}

/**
 * Verify the full DPP chain starting from a known data_hash.
 *
 * Walks backward: entry → pack → celula → origem
 * If the entry credential has ref_pack_tx, it's a reciclagem credential
 * and we follow it to the pack first.
 *
 * Uses dual-path verification: Blockfrost metadata first, UVerify API fallback.
 */
export async function verifyChain(
  config: PipelineConfig,
  entryDataHash: string,
  entryTxHash?: string,
): Promise<void> {
  console.log("=".repeat(64));
  console.log("DPP Chain Verification");
  console.log("=".repeat(64));
  console.log(`\nEntry data_hash: ${entryDataHash}`);
  if (entryTxHash) {
    console.log(`Entry tx_hash:   ${entryTxHash}`);
  }

  // Step 1: Look up the entry credential.
  console.log("\n[1/?] Looking up entry credential...");
  const entry = await verifyCredential(config, entryDataHash, entryTxHash);
  printCredential("Entry", entry);

  // Auto-detect: reciclagem has ref_pack_tx
  let credReciclagem: VerifiedCredential | undefined;
  let credPack: VerifiedCredential;

  if (entry.references["pack_tx"]) {
    credReciclagem = entry;
    const packTx = entry.references["pack_tx"];
    const packDh = entry.dataHashes["pack_data_hash"];
    if (!packDh) {
      throw new Error(
        "Broken chain: reciclagem credential has ref_pack_tx but is missing ref_pack_data_hash",
      );
    }
    console.log("\n[2/5] Detected reciclagem — following to pack...");
    credPack = await verifyCredential(config, packDh, packTx);
    printCredential("Pack", credPack);
  } else {
    credPack = entry;
  }

  const totalSteps = credReciclagem ? 5 : 4;
  const offset = credReciclagem ? 1 : 0;

  // Step: Follow reference to celula.
  const step2 = 2 + offset;
  console.log(`\n[${step2}/${totalSteps}] Following reference to celula...`);
  let credCelula: VerifiedCredential | undefined;
  const celulaTx = credPack.references["celula_tx"];
  const celulaDh = credPack.dataHashes["celula_data_hash"];
  if (celulaTx || celulaDh) {
    credCelula = await verifyCredential(config, celulaDh, celulaTx);
    printCredential("Celula", credCelula);
  } else {
    console.log("  WARNING: Pack does not reference a celula credential.");
  }

  // Step: Follow reference to origem.
  const step3 = 3 + offset;
  console.log(`\n[${step3}/${totalSteps}] Following reference to origem...`);
  let credOrigem: VerifiedCredential | undefined;
  if (credCelula) {
    const origemTx = credCelula.references["origem_tx"];
    const origemDh = credCelula.dataHashes["origem_data_hash"];
    if (origemTx || origemDh) {
      credOrigem = await verifyCredential(config, origemDh, origemTx);
      printCredential("Origem", credOrigem);
    } else {
      console.log(
        "  WARNING: Celula does not reference an origem credential.",
      );
    }
  }

  // Summary
  const stepFinal = 4 + offset;
  console.log(`\n[${stepFinal}/${totalSteps}] Chain verification summary:`);
  console.log("  " + "=".repeat(50));
  const chain = [
    { label: "Origem (lithium)", cred: credOrigem },
    { label: "Celula (cells)", cred: credCelula },
    { label: "Pack (battery)", cred: credPack },
  ];
  if (credReciclagem) {
    chain.push({ label: "Reciclagem (recycling)", cred: credReciclagem });
  }
  for (const { label, cred } of chain) {
    const status = cred ? "VERIFIED" : "MISSING";
    const name = cred?.name ?? "—";
    console.log(`  ${status}: ${label} → ${name}`);
  }
  console.log("  " + "=".repeat(50));
}

// ── CLI entry point ─────────────────────────────────────────────────
// Usage: deno task verify
// Reads DATA_HASH_PACK and TX_HASH_PACK from .env

if (import.meta.main) {
  await import("@std/dotenv/load");
  const { loadConfig } = await import("./config.ts");

  const config = loadConfig();
  const entryDataHash = Deno.env.get("DATA_HASH_PACK")?.trim();
  const entryTxHash = Deno.env.get("TX_HASH_PACK")?.trim();

  if (!entryDataHash) {
    console.error(
      "ERROR: DATA_HASH_PACK is required in .env for verification.",
    );
    Deno.exit(1);
  }

  await verifyChain(config, entryDataHash, entryTxHash);
}
