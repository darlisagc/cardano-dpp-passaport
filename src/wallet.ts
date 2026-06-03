/**
 * Geração de carteiras, derivação de chaves e callbacks de assinatura.
 *
 * Usa @evolution-sdk/evolution para:
 *   - Geração de mnemonic BIP-39 (PrivateKey.generateMnemonic)
 *   - Derivação de Enterprise address (Address.fromSeed)
 *   - Derivação de chaves CIP-1852 (PrivateKey.fromMnemonicCardano)
 *   - Assinatura manual de transações (extrair body → blake2b-256 → assinar Ed25519 → VKeyWitness)
 *   - Assinatura de mensagens CIP-8 via COSE (COSE.SignData.signData)
 *   - Construção e submissão de transações via Client (client.newTx)
 *
 * Cada ator recebe seu próprio mnemonic e Enterprise address.
 */

import {
  Address,
  Client,
  COSE,
  preprod,
  PrivateKey,
  Transaction,
  TransactionWitnessSet,
  VKey,
} from "@evolution-sdk/evolution";
import { blake2b } from "npm:@noble/hashes@1/blake2b";
import type { ActorName, ActorWallet } from "./types.ts";

/** Converte Uint8Array para string hexadecimal. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Converte string hexadecimal para Uint8Array. */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Gera um novo mnemonic BIP-39 de 24 palavras (256 bits de entropia).
 */
export function generateMnemonic(): string {
  return PrivateKey.generateMnemonic(256);
}

/**
 * Cria uma ActorWallet com callbacks de assinatura para o UVerify.
 *
 * Usa construção manual de testemunhas para signTx:
 *   - signTx:      Extrai os bytes do corpo da transação do CBOR não assinado,
 *                   faz hash com blake2b-256, assina com a chave privada de pagamento,
 *                   e constrói um VKeyWitness diretamente. Isso evita o problema
 *                   onde Client.signTx() produz conjuntos de testemunhas vazios/malformados
 *                   para transações construídas externamente (ex: colateral do UVerify).
 *   - signMessage:  Usa COSE.SignData.signData() diretamente com a chave privada
 *                   derivada. Isso produz o formato CIP-8 DataSignature
 *                   ({ key: CBOR(COSE_Key), signature: CBOR(COSE_Sign1) })
 *                   que o UVerify espera.
 *
 * As duas abordagens de assinatura são necessárias porque o signMessage do Client
 * retorna o formato SignedMessage em nível de carteira, enquanto o UVerify espera o
 * formato CIP-30 DataSignature com strings hex { key, signature }.
 */
export async function createActorWallet(
  name: ActorName,
  mnemonic: string,
  blockfrostConfig: { baseUrl: string; projectId: string },
): Promise<ActorWallet> {
  // Cria um SigningClient completo para assinatura de transações.
  const client = Client.make(preprod)
    .withBlockfrost(blockfrostConfig)
    .withSeed({
      mnemonic,
      accountIndex: 0,
      addressType: "Enterprise",
    });

  // Obtém o Enterprise address derivado.
  const addr = await client.address();
  const addressBech32 = Address.toBech32(addr);
  const addressHex = Address.toHex(addr);

  // Deriva a chave privada de pagamento para assinatura de mensagens CIP-8.
  // Caminho: m/1852'/1815'/0'/0/0 (chave de pagamento padrão CIP-1852).
  const paymentKey = PrivateKey.fromMnemonicCardano(mnemonic, {
    account: 0,
    role: 0, // pagamento
    index: 0,
  });

  // Deriva a chave pública de verificação a partir da chave privada de pagamento.
  const vkey = VKey.fromPrivateKey(paymentKey);

  // signTx: Construção manual de testemunhas para transações construídas externamente.
  // Extrai os bytes do corpo do CBOR não assinado, faz hash com blake2b-256,
  // assina com a chave de pagamento e constrói um VKeyWitness adequado.
  // Substitui Client.signTx() que produz testemunhas malformadas para
  // transações construídas por serviços externos (endpoint de colateral do UVerify).
  const signTx = async (unsignedCborHex: string): Promise<string> => {
    // Converte hex para bytes.
    const txBytes = fromHex(unsignedCborHex);

    // Extrai os bytes brutos do corpo (preservando a codificação CBOR exata).
    const bodyBytes = Transaction.extractBodyBytes(txBytes);

    // Faz hash do corpo com blake2b-256 (hash do corpo da transação Cardano).
    const bodyHash = blake2b(bodyBytes, { dkLen: 32 });

    // Assina o hash do corpo com a chave privada de pagamento (Ed25519).
    const signature = PrivateKey.sign(paymentKey, bodyHash);

    // Constrói um conjunto de testemunhas com um único VKeyWitness.
    const witnessSet = TransactionWitnessSet.fromVKeyWitnesses([
      new TransactionWitnessSet.VKeyWitness({ vkey, signature }),
    ]);

    return TransactionWitnessSet.toCBORHex(witnessSet);
  };

  // signMessage: Assinatura de mensagens COSE CIP-8 para operações de estado do UVerify.
  // Usa COSE.SignData.signData() diretamente para produzir o formato CIP-30 DataSignature
  // que o UVerify espera: { key: hex(COSE_Key), signature: hex(COSE_Sign1) }.
  const signMessage = async (
    message: string,
  ): Promise<{ key: string; signature: string }> => {
    const payload = COSE.Utils.fromText(message);
    const result = COSE.SignData.signData(addressHex, payload, paymentKey);
    return {
      key: toHex(result.key),
      signature: toHex(result.signature),
    };
  };

  return { name, mnemonic, address: addressBech32, signTx, signMessage, client };
}

/**
 * Cria um SigningClient evolution-sdk para a carteira principal.
 * Usado para a transferência de financiamento (carteira principal → carteiras dos atores).
 * Usa o tipo de endereço Base padrão pois a carteira principal já possui fundos.
 */
export function createMainWalletClient(
  mnemonic: string,
  blockfrostConfig: { baseUrl: string; projectId: string },
) {
  return Client.make(preprod)
    .withBlockfrost(blockfrostConfig)
    .withSeed({ mnemonic, accountIndex: 0 });
}

/**
 * Obtém o endereço bech32 de um client evolution-sdk.
 */
export async function getClientAddress(
  client: ReturnType<typeof createMainWalletClient>,
): Promise<string> {
  const addr = await client.address();
  return Address.toBech32(addr);
}
