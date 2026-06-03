/**
 * Verificação de cadeia — verifica cada credencial e percorre a cadeia
 * de trás para frente, do pack (ou reciclagem) até a origem.
 *
 * Suporta dois caminhos de verificação:
 *   1. API UVerify (GET /api/v1/verify/{dataHash}) — para credenciais emitidas via UVerify
 *   2. Metadados Blockfrost (GET /txs/{txHash}/metadata) — para credenciais com metadados diretos
 *
 * Quando um tx_hash é conhecido, os metadados Blockfrost são tentados primeiro (funciona para
 * ambos os modos), com fallback para a API UVerify.
 */

import type { PipelineConfig } from "./types.ts";

/** Dados da credencial extraídos da resposta de verificação. */
export interface VerifiedCredential {
  name?: string;
  issuer?: string;
  gtin?: string;
  origin?: string;
  manufactured?: string;
  carbonFootprint?: string;
  recycledContent?: string;
  materials: Record<string, string>;
  references: Record<string, string>; // campos ref_*_tx
  dataHashes: Record<string, string>; // campos ref_*_data_hash
  txHash?: string;
}

/**
 * Classifica os campos de metadados por convenção de nomenclatura.
 *
 * Os payloads DPP usam chaves com prefixo para codificar diferentes tipos de dados:
 *   - ref_*_tx      → referências de hash de tx para atores anteriores na cadeia
 *   - ref_*_data_hash → referências de data_hash para verificação cruzada
 *   - mat_*         → percentuais de composição de materiais
 *
 * Esta função separa um Record de metadados plano em três mapas categorizados,
 * removendo o prefixo "ref_" das chaves de referência para acesso mais limpo.
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
 * Converte um valor de metadado Blockfrost de volta para string simples.
 *
 * Valores de metadados do Blockfrost podem ser:
 *   - string: retornado como está
 *   - array: strings fragmentadas (valores > 64 bytes), reunidas novamente
 *   - number/bigint: convertido para string
 *
 * Isso trata a fragmentação feita por issuer-direto.ts para valores longos.
 */
function metadatumToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(metadatumToString).join("");
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return String(value);
}

/**
 * Analisa um objeto JSON de metadados Blockfrost em um Record<string, string> plano.
 *
 * O Blockfrost retorna metadados de transação como um array de entradas por label:
 *   [{ label: "1990", json_metadata: { key: value, ... } }]
 *
 * Esta função encontra o label DPP (1990), extrai o objeto json_metadata
 * e converte todos os valores para strings (tratando arrays fragmentados
 * via metadatumToString). Retorna null se o label 1990 não for encontrado.
 */
function parseBlockfrostMetadata(
  metadataArray: Array<{ label: string; json_metadata: unknown }>,
): Record<string, string> | null {
  // Encontra nosso label (1990)
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
 * Verifica uma credencial buscando metadados nativos do Blockfrost.
 *
 * Chama GET /txs/{txHash}/metadata na API Blockfrost, procura o
 * label 1990 e analisa o payload DPP em um VerifiedCredential.
 * Funciona para credenciais emitidas no modo metadata (issuer-direto.ts).
 * Retorna null se a tx não tiver metadados com label 1990 (ex: modo UVerify).
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
 * Busca uma credencial no UVerify por data_hash.
 *
 * Chama GET /api/v1/verify/{dataHash} na API pública do UVerify.
 * A API retorna um array de credenciais correspondentes; se tx_hash é
 * fornecido, a correspondência exata é preferida. Retorna o primeiro
 * resultado como fallback se nenhuma correspondência exata de tx for encontrada.
 * Funciona para credenciais emitidas no modo UVerify (issuer.ts).
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

  // Encontra correspondência exata de tx, ou usa o primeiro item como fallback.
  let match = items[0];
  if (txHash) {
    const exact = items.find(
      (item: Record<string, unknown>) =>
        item.transactionHash === txHash,
    );
    if (exact) match = exact;
  }

  // Analisa os metadados.
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
 * Busca uma credencial usando verificação de caminho duplo.
 *
 * Quando um tx_hash está disponível, tenta os metadados nativos Blockfrost primeiro
 * (funciona tanto para credenciais com metadados diretos quanto para credenciais
 * emitidas via UVerify que possuem o label 1990). Usa a API UVerify como fallback.
 */
async function verifyCredential(
  config: PipelineConfig,
  dHash?: string,
  txHash?: string,
): Promise<VerifiedCredential> {
  // Tenta metadados Blockfrost primeiro quando temos um tx_hash.
  if (txHash) {
    const bfResult = await verifyByBlockfrostMetadata(config, txHash);
    if (bfResult) {
      console.log("  (verified via Blockfrost metadata)");
      return bfResult;
    }
  }

  // Fallback para a API UVerify (requer data_hash).
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
 * Imprime o resumo de uma credencial verificada no console.
 *
 * Exibe o nome da credencial, emissor, origem, GTIN, data, pegada de CO2,
 * composição de materiais (se houver) e um link Cexplorer para a transação.
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
 * Verifica a cadeia DPP completa a partir de um data_hash conhecido.
 *
 * Percorre de trás para frente: entrada → pack → celula → origem
 * Se a credencial de entrada tem ref_pack_tx, é uma credencial de reciclagem
 * e seguimos primeiro até o pack.
 *
 * Usa verificação de caminho duplo: metadados Blockfrost primeiro, API UVerify como fallback.
 */
export async function verifyChain(
  config: PipelineConfig,
  entryDataHash: string,
  entryTxHash?: string,
): Promise<{
  credOrigem?: VerifiedCredential;
  credCelula?: VerifiedCredential;
  credPack: VerifiedCredential;
  credReciclagem?: VerifiedCredential;
}> {
  console.log("=".repeat(64));
  console.log("DPP Chain Verification");
  console.log("=".repeat(64));
  console.log(`\nEntry data_hash: ${entryDataHash}`);
  if (entryTxHash) {
    console.log(`Entry tx_hash:   ${entryTxHash}`);
  }

  // Etapa 1: Buscar a credencial de entrada.
  console.log("\n[1/?] Looking up entry credential...");
  const entry = await verifyCredential(config, entryDataHash, entryTxHash);
  printCredential("Entry", entry);

  // Detecção automática: reciclagem tem ref_pack_tx
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

  // Etapa: Seguir referência para célula.
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

  // Etapa: Seguir referência para origem.
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

  // Resumo
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

  // Retorna as credenciais verificadas para geração de relatórios.
  return { credOrigem, credCelula, credPack, credReciclagem };
}

// ── Ponto de entrada CLI ─────────────────────────────────────────────────
// Uso:
//   deno task verify              → detecção automática: reciclagem se disponível, senão pack
//   deno task verify pack         → inicia a partir do pack (DATA_HASH_PACK)
//   deno task verify reciclagem   → inicia a partir da reciclagem (DATA_HASH_ATOR4)

if (import.meta.main) {
  await import("@std/dotenv/load");
  const { loadConfig } = await import("./config.ts");
  const { openVerificationReport } = await import(
    "./reports/verification-report.ts"
  );

  const config = loadConfig();

  // Determina o ponto de entrada a partir do argumento CLI ou detecção automática.
  const arg = Deno.args[0]?.toLowerCase();
  let entryDataHash: string | undefined;
  let entryTxHash: string | undefined;
  let entryLabel: string;

  if (arg === "pack") {
    entryDataHash = Deno.env.get("DATA_HASH_PACK")?.trim();
    entryTxHash = Deno.env.get("TX_HASH_PACK")?.trim();
    entryLabel = "pack";
  } else if (arg === "reciclagem") {
    entryDataHash = Deno.env.get("DATA_HASH_ATOR4")?.trim();
    entryTxHash = Deno.env.get("ATOR4_TX")?.trim();
    entryLabel = "reciclagem";
  } else if (arg && arg !== "") {
    console.error(`ERROR: Unknown entry point "${arg}". Use "pack" or "reciclagem".`);
    Deno.exit(1);
  } else {
    // Detecção automática: prefere reciclagem se disponível, fallback para pack.
    const reciclagemHash = Deno.env.get("DATA_HASH_ATOR4")?.trim();
    if (reciclagemHash) {
      entryDataHash = reciclagemHash;
      entryTxHash = Deno.env.get("ATOR4_TX")?.trim();
      entryLabel = "reciclagem (auto-detected)";
    } else {
      entryDataHash = Deno.env.get("DATA_HASH_PACK")?.trim();
      entryTxHash = Deno.env.get("TX_HASH_PACK")?.trim();
      entryLabel = "pack (default)";
    }
  }

  if (!entryDataHash) {
    console.error(
      "ERROR: No entry point found. Ensure DATA_HASH_PACK or DATA_HASH_ATOR4 is set in .env.",
    );
    Deno.exit(1);
  }

  console.log(`\nEntry point: ${entryLabel}`);
  console.log(`  data_hash: ${entryDataHash}`);
  if (entryTxHash) console.log(`  tx_hash:   ${entryTxHash}`);

  const { credOrigem, credCelula, credPack, credReciclagem } =
    await verifyChain(config, entryDataHash, entryTxHash);

  // Gera e abre o relatório de verificação no navegador.
  console.log("\nGenerating verification report...");
  await openVerificationReport({
    origem: credOrigem,
    celula: credCelula,
    pack: credPack,
    reciclagem: credReciclagem,
  });
}
