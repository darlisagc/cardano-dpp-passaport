/**
 * Emissão de credenciais com metadados diretos — sem contratos inteligentes.
 *
 * Constrói transações com payloads DPP como metadados nativos Cardano
 * sob o label 1990. Apenas a taxa de rede é paga; o troco volta para
 * a carteira emissora. Usa o Client do evolution-sdk para
 * construção de transações e Blockfrost para polling de confirmação.
 *
 * Análogo ao Python `emissor_direto.py` — grava o payload completo
 * da credencial diretamente nos metadados da transação.
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

/** Label de metadados para credenciais DPP (corresponde à implementação Python). */
const METADATA_LABEL = 1990n;

/** Comprimento máximo de texto para uma única string de metadados Cardano (64 bytes). */
const MAX_TEXT_BYTES = 64;

const MAX_ATTEMPTS = 5;
const INITIAL_DELAY_MS = 10_000;

/**
 * Divide uma string em pedaços que cabem no limite de 64 bytes de texto de metadados.
 *
 * Campos de texto de metadados nativos Cardano são limitados a 64 bytes pela
 * especificação do ledger. Valores maiores que 64 bytes (ex: nomes longos de emissores,
 * hashes de dados) devem ser divididos em um array de pedaços. O verificador
 * remonta juntando os elementos do array.
 *
 * Usa uma abordagem consciente de bytes: corta do final caractere por caractere
 * até que a fatia codificada em UTF-8 caiba em 64 bytes.
 */
function chunkString(value: string): string[] {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);
  if (encoded.length <= MAX_TEXT_BYTES) return [value];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    // Começa com a string restante completa, corta até caber
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
 * Converte um DppPayload (Record<string, string>) para um Map de TransactionMetadatum.
 *
 * Trata o limite de 64 bytes de texto dividindo valores longos em arrays.
 * As chaves são sempre curtas o suficiente (<64 bytes) e não precisam de divisão.
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
 * Aguarda a confirmação de uma transação on-chain via Blockfrost.
 *
 * Consulta GET /txs/{txHash} a cada 5 segundos até que o Blockfrost retorne
 * HTTP 200 (tx está on-chain) ou o timeout expire (padrão 90s).
 * Usado para transações no modo metadata que não passam pelo UVerify.
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
      // Erro de rede — tentar novamente
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

/**
 * Emite uma única credencial para um ator usando metadados nativos diretos.
 *
 * Constrói uma transação somente com metadados (paga apenas a taxa de rede; o troco
 * volta para a carteira emissora) com o payload DPP sob o label 1990.
 */
export async function issueCredentialDireto(
  config: PipelineConfig,
  wallet: ActorWallet,
  env: PayloadEnv,
): Promise<IssuanceResult> {
  const actor = wallet.name;
  console.log(`\n  Issuing credential for ${actor} (direct metadata)...`);

  // 1. Constrói o payload DPP.
  const { payload, serial, gtin } = await PAYLOAD_BUILDERS[actor](env);

  // 2. Calcula o data_hash (impressão digital do produto).
  const hash = await dataHash(gtin, serial);
  console.log(`  data_hash: ${hash}`);

  // Inclui data_hash nos metadados on-chain para referência cruzada.
  payload["data_hash"] = hash;

  // 3. Converte o payload para TransactionMetadatum.
  const metadatumMap = payloadToMetadatum(payload);

  // 4. Constrói, assina e submete com retentativa.
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

      // Aguarda confirmação on-chain.
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

      // Fatal: sem UTXOs — carteira vazia.
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
 * Emite credenciais para todos os 4 atores sequencialmente usando metadados diretos.
 *
 * Ordem de emissão: origem → celula → pack → reciclagem.
 * Mesma dependência sequencial de issueAllCredentials em issuer.ts:
 * cada ator referencia o txHash do ator anterior (campos ref_*_tx),
 * portanto a emissão paralela não é possível. O PayloadEnv é atualizado após
 * cada emissão com o txHash resultante para que o próximo ator possa referenciá-lo.
 *
 * Usado por main.ts quando EMISSION_MODE=metadata.
 */
export async function issueAllCredentialsDireto(
  config: PipelineConfig,
  wallets: Record<ActorName, ActorWallet>,
  env: PayloadEnv,
): Promise<IssuanceResult[]> {
  console.log("\n--- STEP 4: Issue credentials (direct metadata) ---");
  const results: IssuanceResult[] = [];

  // Ator 1: Origem (sem referências)
  const r1 = await issueCredentialDireto(config, wallets.origem, env);
  env.ator1Tx = r1.txHash;
  results.push(r1);

  // Ator 2: Célula (referencia o Ator 1)
  const r2 = await issueCredentialDireto(config, wallets.celula, env);
  env.ator2Tx = r2.txHash;
  results.push(r2);

  // Ator 3: Pack (referencia o Ator 2)
  const r3 = await issueCredentialDireto(config, wallets.pack, env);
  env.ator3Tx = r3.txHash;
  results.push(r3);

  // Ator 4: Reciclagem (referencia os Atores 1, 2, 3)
  const r4 = await issueCredentialDireto(config, wallets.reciclagem, env);
  results.push(r4);

  return results;
}
