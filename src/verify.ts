/**
 * Chain verification — verifies each credential and walks the chain
 * backward from pack (or reciclagem) to origin.
 *
 * Uses the UVerify public API (GET /api/v1/verify/{dataHash}) to
 * look up credentials by their data_hash.
 */

import type { PipelineConfig } from "./types.ts";

/** Credential data extracted from UVerify verification response. */
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
 */
export async function verifyChain(
  config: PipelineConfig,
  entryDataHash: string,
  entryTxHash?: string,
): Promise<void> {
  const baseUrl = config.uverifyApiUrl;

  console.log("=" .repeat(64));
  console.log("DPP Chain Verification");
  console.log("=" .repeat(64));
  console.log(`\nEntry data_hash: ${entryDataHash}`);

  // Step 1: Look up the entry credential.
  console.log("\n[1/?] Looking up entry credential...");
  const entry = await verifyByDataHash(baseUrl, entryDataHash, entryTxHash);
  printCredential("Entry", entry);

  // Auto-detect: reciclagem has ref_pack_tx
  let credReciclagem: VerifiedCredential | undefined;
  let credPack: VerifiedCredential;

  if (entry.references["pack_tx"]) {
    credReciclagem = entry;
    const packTx = entry.references["pack_tx"]!;
    const packDh = entry.dataHashes["pack_data_hash"];
    console.log("\n[2/5] Detected reciclagem — following to pack...");
    credPack = await verifyByDataHash(baseUrl, packDh!, packTx);
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
  if (celulaTx && celulaDh) {
    credCelula = await verifyByDataHash(baseUrl, celulaDh, celulaTx);
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
    if (origemTx && origemDh) {
      credOrigem = await verifyByDataHash(baseUrl, origemDh, origemTx);
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
