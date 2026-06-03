/**
 * Lógica de emissão de credenciais via UVerify.
 *
 * Emite credenciais DPP para cada ator usando o SDK JS do UVerify.
 * Usa o fluxo de baixo nível core.buildTransaction() + core.submitTransaction()
 * para controle total sobre campos personalizados ref_*_tx.
 *
 * Inclui retentativas automáticas com intervalos crescentes para erros transitórios da API.
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
 * Aguarda a confirmação de uma transação UVerify on-chain.
 *
 * Consulta o endpoint de confirmação do UVerify (GET /api/v1/transaction/confirm/{txHash})
 * a cada 5 segundos até retornar HTTP 200 (confirmado) ou o timeout expirar.
 * Retorna true se confirmado, false se o timeout foi atingido.
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
      // Erro de rede — tentar novamente
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

/**
 * Consulta o endpoint de colateral até que o UTxO esteja confirmado como disponível.
 *
 * Scripts Plutus V3 requerem um UTxO de colateral (>= 5 ADA) presente
 * antes de construir transações de credencial. Esta função chama repetidamente
 * POST /prepare-collateral até que a resposta indique que o colateral
 * está disponível (COLLATERAL_ALREADY_AVAILABLE ou sem unsignedTransaction).
 * Retorna assim que o colateral estiver pronto, ou após timeoutMs (padrão 60s).
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
        // Nenhuma tx necessária — colateral existe
        console.log("  Collateral ready (no action needed).");
        return;
      }
    } catch {
      // Erro de rede — tentar novamente
    }
  }
  console.log("  WARNING: Collateral readiness timeout — proceeding anyway.");
}

/**
 * Prepara o UTxO de colateral (>= 5 ADA) para scripts Plutus V3.
 *
 * Usa fetch direto para o endpoint específico de colateral (sem método no SDK),
 * mas delega a submissão ao core.submitTransaction() do SDK UVerify
 * para tratamento adequado de erros e serialização.
 */
async function prepareCollateral(
  baseUrl: string,
  address: string,
  signTx: (tx: string) => Promise<string>,
  client?: InstanceType<typeof UVerifyClient>,
): Promise<void> {
  console.log("  [collateral] Checking collateral...");

  // --- Etapa 1: Verificar / solicitar colateral via endpoint dedicado ---
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

  // --- Etapa 2: Assinar e submeter ---
  console.log("  [collateral] Creating collateral UTXO (5 ADA)...");
  const witnessSet = await signTx(unsignedTx);

  try {
    let collateralTxHash: string | undefined;

    if (client) {
      // Usa o submitTransaction do SDK para tratamento adequado de erros.
      collateralTxHash = await client.core.submitTransaction(
        unsignedTx,
        witnessSet,
      );
    } else {
      // Fallback para fetch direto quando nenhum client é fornecido.
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
 * Emite uma única credencial para um ator via contratos inteligentes UVerify.
 *
 * Usa o fluxo de baixo nível do UVerify para controle total sobre o payload:
 *   1. Constrói o payload DPP (dados do produto + referências a atores anteriores)
 *   2. Calcula data_hash = sha256(gtin + serial) como âncora on-chain
 *   3. Cria um UVerifyClient com os callbacks de assinatura do ator
 *   4. Prepara o UTxO de colateral (>= 5 ADA) para execução Plutus V3
 *   5. Chama core.buildTransaction() — UVerify constrói a tx Cardano com
 *      o script de referência Plutus V3, redeemer e saída do endereço do script
 *   6. Assina a tx não assinada com a chave de pagamento do ator
 *   7. Chama core.submitTransaction() — UVerify submete ao nó Cardano
 *   8. Aguarda confirmação on-chain via polling
 *
 * Inclui retentativa com backoff exponencial (5 tentativas, iniciando em 40s) para
 * erros transitórios. Trata status especiais: COLLATERAL_REQUIRED
 * (re-prepara colateral), PENDING_TRANSACTION (aguarda 30s).
 * Erro fatal: "no utxos found" (carteira vazia) — lança imediatamente.
 */
export async function issueCredential(
  config: PipelineConfig,
  wallet: ActorWallet,
  env: PayloadEnv,
): Promise<IssuanceResult> {
  const actor = wallet.name;
  console.log(`\n  Issuing credential for ${actor}...`);

  // 1. Constrói o payload DPP.
  const { payload, serial, gtin } = await PAYLOAD_BUILDERS[actor](env);

  // 2. Calcula o data_hash (impressão digital do produto).
  const hash = await dataHash(gtin, serial);
  console.log(`  data_hash: ${hash}`);

  // 3. Cria o client UVerify com os callbacks de assinatura deste ator.
  const client = new UVerifyClient({
    baseUrl: config.uverifyApiUrl,
    signTx: wallet.signTx,
    signMessage: wallet.signMessage,
  });

  // 4. Prepara colateral para scripts Plutus V3 (passa client para submissão via SDK).
  await prepareCollateral(config.uverifyApiUrl, wallet.address, wallet.signTx, client);

  // Consulta até que o UTxO de colateral tenha sido confirmado.
  console.log("  Polling for collateral readiness...");
  await waitForCollateralReady(config.uverifyApiUrl, wallet.address);

  // 5. Emite com retentativa e backoff exponencial.
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Constrói a transação de emissão do certificado.
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

      // Verifica códigos de status que precisam de tratamento.
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

      // Assina a transação não assinada.
      const unsignedTx = buildResult.unsignedTransaction;
      if (!unsignedTx) {
        throw new Error(
          `buildTransaction returned no unsignedTransaction (status: ${buildResult.status?.message ?? "unknown"})`,
        );
      }
      const witnessSet = await wallet.signTx(unsignedTx);

      // Submete a transação assinada.
      const txHash = await client.core.submitTransaction(
        unsignedTx,
        witnessSet,
      );

      console.log(`  tx_hash: ${txHash}`);

      // Aguarda confirmação on-chain antes de retornar.
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

      // Fatal: sem UTXOs — carteira vazia.
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
 * Emite credenciais para todos os 4 atores sequencialmente via contratos inteligentes UVerify.
 *
 * Ordem de emissão: origem → celula → pack → reciclagem.
 * Cada ator referencia o txHash do ator anterior (campos ref_*_tx),
 * portanto a emissão paralela não é possível. O PayloadEnv é atualizado após
 * cada emissão com o txHash resultante para que o próximo ator possa referenciá-lo.
 *
 * Usado por main.ts quando EMISSION_MODE=uverify (padrão).
 */
export async function issueAllCredentials(
  config: PipelineConfig,
  wallets: Record<ActorName, ActorWallet>,
  env: PayloadEnv,
): Promise<IssuanceResult[]> {
  console.log("\n--- STEP 4: Issue credentials ---");
  const results: IssuanceResult[] = [];

  // Ator 1: Origem (sem referências)
  const r1 = await issueCredential(config, wallets.origem, env);
  env.ator1Tx = r1.txHash;
  results.push(r1);

  // Ator 2: Célula (referencia o Ator 1)
  const r2 = await issueCredential(config, wallets.celula, env);
  env.ator2Tx = r2.txHash;
  results.push(r2);

  // Ator 3: Pack (referencia o Ator 2)
  const r3 = await issueCredential(config, wallets.pack, env);
  env.ator3Tx = r3.txHash;
  results.push(r3);

  // Ator 4: Reciclagem (referencia os Atores 1, 2, 3)
  const r4 = await issueCredential(config, wallets.reciclagem, env);
  results.push(r4);

  return results;
}
