/**
 * CLI: deno task issue-<ator>
 *
 * Emite a credencial de um único ator, lendo pré-requisitos do .env
 * e salvando os resultados de volta no .env.
 *
 * Uso:
 *   deno task issue-origem       # Ator 1 — sem pré-requisitos
 *   deno task issue-celula       # Ator 2 — requer ATOR1_TX no .env
 *   deno task issue-pack         # Ator 3 — requer ATOR2_TX no .env
 *   deno task issue-reciclagem   # Ator 4 — requer ATOR1_TX, ATOR2_TX, ATOR3_TX
 */

import { loadConfig } from "../config.ts";
import { issueCredentialDireto } from "../issuer-direto.ts";
import { issueCredential } from "../issuer.ts";
import { buildPayloadEnv, PAYLOAD_BUILDERS } from "../payloads.ts";
import type { PayloadEnv } from "../payloads.ts";
import { openEmissionReceipt } from "../reports/emission-receipt.ts";
import { openReciclagemReport } from "../reports/reciclagem-report.ts";
import { appendToEnv, readEnvVar } from "../state.ts";
import type { ActorName } from "../types.ts";
import { ACTOR_ENV_KEY } from "../types.ts";
import { createActorWallet } from "../wallet.ts";

/** Mapeia nome do ator → número do ator para nomenclatura de variáveis .env. */
const ACTOR_NUMBERS: Record<ActorName, string> = {
  origem: "1",
  celula: "2",
  pack: "3",
  reciclagem: "4",
};

/** Pré-requisitos: quais variáveis ATOR*_TX devem existir antes de emitir cada ator. */
const PREREQUISITES: Record<ActorName, string[]> = {
  origem: [],
  celula: ["ATOR1_TX"],
  pack: ["ATOR2_TX"],
  reciclagem: ["ATOR1_TX", "ATOR2_TX", "ATOR3_TX"],
};

/** Nomes amigáveis para a dica do próximo passo. */
const NEXT_STEP: Record<ActorName, string> = {
  origem: "deno task issue-celula",
  celula: "deno task issue-pack",
  pack: "deno task issue-reciclagem",
  reciclagem: "deno task verify",
};

const VALID_ACTORS: ActorName[] = ["origem", "celula", "pack", "reciclagem"];

function usage(): never {
  console.error("Usage: deno task issue-<actor>");
  console.error("  Actors: origem, celula, pack, reciclagem");
  console.error("");
  console.error("Examples:");
  console.error("  deno task issue-origem");
  console.error("  deno task issue-celula");
  Deno.exit(1);
}

/**
 * Ponto de entrada principal da emissão.
 *
 * Analisa o nome do ator dos argumentos CLI, carrega a configuração, verifica
 * pré-requisitos (atores anteriores devem ser emitidos primeiro), recria a
 * carteira do ator a partir do mnemonic armazenado, constrói o payload DPP
 * e emite a credencial.
 *
 * O modo de emissão é determinado por EMISSION_MODE no .env (ou override via variável de ambiente):
 *   - "uverify" (padrão): emite via SDK UVerify + contratos inteligentes Plutus V3
 *   - "metadata": emite via metadados nativos Cardano (label 1990)
 *
 * Os resultados (tx_hash, data_hash) são salvos no .env para o próximo passo.
 * Para o ator pack, também salva TX_HASH_PACK e DATA_HASH_PACK
 * que são usados pelo `deno task verify`.
 */
async function main(): Promise<void> {
  // ── Analisar nome do ator dos argumentos CLI ────────────────────────────
  const actorArg = Deno.args[0]?.trim().toLowerCase();
  if (!actorArg || !VALID_ACTORS.includes(actorArg as ActorName)) {
    console.error(`Error: Invalid or missing actor name: "${actorArg}"`);
    usage();
  }
  const actor = actorArg as ActorName;
  const num = ACTOR_NUMBERS[actor];

  console.log("=".repeat(64));
  console.log(`Cardano DPP Passaport — Issue credential: ${actor} (Ator ${num})`);
  console.log("=".repeat(64));

  // ── Carregar configuração ────────────────────────────────────────
  console.log("\nLoading configuration...");
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(
      `Configuration error: ${e instanceof Error ? e.message : e}`,
    );
    Deno.exit(1);
  }

  // ── Verificar pré-requisitos ───────────────────────────────────────
  const prereqs = PREREQUISITES[actor];
  for (const key of prereqs) {
    const val = readEnvVar(key);
    if (!val) {
      console.error(`\nError: ${key} is not set in .env`);
      console.error(
        `You must issue the previous actor's credential first.`,
      );
      console.error("Run the steps in order:");
      console.error("  1. deno task setup");
      console.error("  2. deno task issue-origem");
      console.error("  3. deno task issue-celula");
      console.error("  4. deno task issue-pack");
      console.error("  5. deno task issue-reciclagem");
      Deno.exit(1);
    }
  }

  // ── Carregar mnemonic do ator do .env ─────────────────────────────
  const mnemonicKey = `ATOR${num}_MNEMONIC`;
  const mnemonic = readEnvVar(mnemonicKey);
  if (!mnemonic) {
    console.error(`\nError: ${mnemonicKey} is not set in .env`);
    console.error("Run 'deno task setup' first to generate actor wallets.");
    Deno.exit(1);
  }

  // ── Recriar a carteira do ator a partir do mnemonic armazenado ──────────
  console.log(`\nRecreating wallet for ${actor} from stored mnemonic...`);
  const blockfrostConfig = {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  };
  const wallet = await createActorWallet(actor, mnemonic, blockfrostConfig);
  console.log(`  Address: ${wallet.address}`);

  // ── Construir PayloadEnv a partir dos hashes de tx armazenados ────────────────────
  const env: PayloadEnv = await buildPayloadEnv(config.mainWalletMnemonic);

  // Carrega hashes de tx emitidos anteriormente no env.
  const ator1Tx = readEnvVar("ATOR1_TX");
  const ator2Tx = readEnvVar("ATOR2_TX");
  const ator3Tx = readEnvVar("ATOR3_TX");
  if (ator1Tx) env.ator1Tx = ator1Tx;
  if (ator2Tx) env.ator2Tx = ator2Tx;
  if (ator3Tx) env.ator3Tx = ator3Tx;

  // ── Emitir a credencial ──────────────────────────────────────
  const result = config.emissionMode === "metadata"
    ? await issueCredentialDireto(config, wallet, env)
    : await issueCredential(config, wallet, env);

  // ── Salvar resultados no .env ──────────────────────────────────
  const txKey = ACTOR_ENV_KEY[actor];
  appendToEnv(txKey, result.txHash);
  appendToEnv(`DATA_HASH_ATOR${num}`, result.dataHash);

  // Para pack, também salva TX_HASH_PACK e DATA_HASH_PACK (usados pelo verify).
  if (actor === "pack") {
    appendToEnv("TX_HASH_PACK", result.txHash);
    appendToEnv("DATA_HASH_PACK", result.dataHash);
  }

  // ── Imprimir resultado ──────────────────────────────────────────────
  console.log("\n" + "=".repeat(64));
  console.log(`CREDENTIAL ISSUED — ${actor} (Ator ${num}) [${config.emissionMode}]`);
  console.log("=".repeat(64));
  console.log(`  tx_hash:   ${result.txHash}`);
  console.log(`  data_hash: ${result.dataHash}`);
  console.log(
    `  Cexplorer: https://preprod.cexplorer.io/tx/${result.txHash}`,
  );
  if (config.emissionMode === "uverify") {
    const appUrl = config.uverifyApiUrl
      .replace("api.preprod.", "app.preprod.")
      .replace("/api/v1", "");
    console.log(`  Verify:    ${appUrl}/verify/${result.dataHash}`);
  }
  console.log(`\n  Saved to .env: ${txKey}=${result.txHash}`);
  console.log(`  Saved to .env: DATA_HASH_ATOR${num}=${result.dataHash}`);
  if (actor === "pack") {
    console.log(`  Saved to .env: TX_HASH_PACK=${result.txHash}`);
    console.log(`  Saved to .env: DATA_HASH_PACK=${result.dataHash}`);
  }
  console.log(`\nNext step: ${NEXT_STEP[actor]}`);

  // ── Gerar recibo de emissão ──────────────────────────────────
  console.log("\nGenerating emission receipt...");
  const receiptPayload = (await PAYLOAD_BUILDERS[actor](env)).payload;
  await openEmissionReceipt({
    actor,
    payload: receiptPayload,
    txHash: result.txHash,
    dataHash: result.dataHash,
  });

  // Para reciclagem, também gera o relatório de reciclagem.
  if (actor === "reciclagem") {
    await new Promise((r) => setTimeout(r, 500));
    console.log("Generating reciclagem report...");
    await openReciclagemReport({
      payload: receiptPayload,
      txHash: result.txHash,
      dataHash: result.dataHash,
    });
  }
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
