/**
 * Transferência de ADA da carteira principal para as 4 carteiras dos atores.
 *
 * Constrói uma única transação com 4 saídas (50 ADA cada = 200 ADA no total)
 * usando o Client do evolution-sdk. Uma única tx é mais rápida e evita
 * problemas de encadeamento de UTxO.
 */

import { Address, Assets, TransactionHash } from "@evolution-sdk/evolution";
import { createMainWalletClient, getClientAddress } from "./wallet.ts";
import type { ActorWallet, PipelineConfig } from "./types.ts";

/** Valor padrão para enviar a cada carteira de ator (50 ADA = 50.000.000 lovelace). */
const DEFAULT_FUNDING_LOVELACE = 50_000_000n;

/**
 * Financia as carteiras dos atores a partir da carteira principal em uma única transação.
 *
 * Cria um Client evolution-sdk para a carteira principal, depois constrói uma
 * única transação Cardano com uma saída por carteira de ator (padrão
 * 50 ADA cada = 200 ADA no total). Usar uma única tx com múltiplas saídas
 * é mais rápido que transferências individuais e evita problemas de encadeamento de UTxO.
 *
 * A tx é construída → assinada → submetida via pipeline do evolution-sdk.
 *
 * @param adaPerWallet — ADA a enviar por carteira (padrão 50).
 * @returns O hash da transação de financiamento.
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

  // Cria o client evolution-sdk com a carteira principal.
  const client = createMainWalletClient(config.mainWalletMnemonic, {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  });

  const mainAddress = await getClientAddress(client);
  console.log(`Main wallet: ${mainAddress}`);

  // Constrói uma única transação com as saídas.
  const txBuilder = client.newTx();

  for (const wallet of actorWallets) {
    txBuilder.payToAddress({
      address: Address.fromBech32(wallet.address),
      assets: Assets.fromLovelace(lovelacePerWallet),
    });
    console.log(`  → ${wallet.name}: ${wallet.address} (${adaPerWallet} ADA)`);
  }

  // Construir → Assinar → Submeter
  const signBuilder = await txBuilder.build();
  const submitBuilder = await signBuilder.sign();
  const txHashObj = await submitBuilder.submit();
  const txHash = TransactionHash.toHex(txHashObj);

  console.log(`\nFunding tx submitted: ${txHash}`);
  console.log(`Cexplorer: https://preprod.cexplorer.io/tx/${txHash}`);

  return txHash;
}

/**
 * Aguarda a confirmação de uma transação on-chain.
 *
 * Consulta a API Blockfrost (GET /txs/{txHash}) a cada 5 segundos até
 * que a tx apareça on-chain (HTTP 200) ou o timeout expire (padrão 120s).
 * Usado após a transação de financiamento para garantir que as carteiras
 * dos atores tenham ADA antes de tentar a emissão de credenciais.
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
      // Erro de rede — tentar novamente
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  console.log("WARNING: Timeout waiting for funding confirmation — proceeding anyway.");
  return false;
}
