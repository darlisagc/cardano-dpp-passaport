/**
 * Wallet generation, key derivation, and signing callbacks.
 *
 * Uses @evolution-sdk/evolution for:
 *   - BIP-39 mnemonic generation (PrivateKey.generateMnemonic)
 *   - Enterprise address derivation (Address.fromSeed)
 *   - CIP-1852 key derivation (PrivateKey.fromMnemonicCardano)
 *   - Transaction signing via Client (client.signTx → TransactionWitnessSet)
 *   - CIP-8 message signing via COSE (COSE.SignData.signData)
 *   - Transaction building & submission via Client (client.newTx)
 *
 * Each actor gets their own mnemonic and Enterprise address.
 */

import {
  Address,
  Client,
  COSE,
  preprod,
  PrivateKey,
  TransactionWitnessSet,
} from "@evolution-sdk/evolution";
import type { ActorName, ActorWallet } from "./types.ts";

/** Convert Uint8Array to hex string. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a new 24-word BIP-39 mnemonic (256-bit entropy).
 */
export function generateMnemonic(): string {
  return PrivateKey.generateMnemonic(256);
}

/**
 * Create an ActorWallet with signing callbacks for UVerify.
 *
 * Uses a hybrid approach:
 *   - signTx:      Delegates to the evolution-sdk SigningClient (handles key
 *                   derivation, body hashing, witness set creation internally).
 *   - signMessage:  Uses COSE.SignData.signData() directly with the derived
 *                   private key. This produces the CIP-8 DataSignature format
 *                   ({ key: CBOR(COSE_Key), signature: CBOR(COSE_Sign1) })
 *                   that UVerify expects.
 *
 * The two signing approaches are necessary because the Client's signMessage
 * returns the wallet-level SignedMessage format, while UVerify expects the
 * CIP-30 DataSignature format with { key, signature } hex strings.
 */
export async function createActorWallet(
  name: ActorName,
  mnemonic: string,
  blockfrostConfig: { baseUrl: string; projectId: string },
): Promise<ActorWallet> {
  // Create a full SigningClient for transaction signing.
  const client = Client.make(preprod)
    .withBlockfrost(blockfrostConfig)
    .withSeed({
      mnemonic,
      accountIndex: 0,
      addressType: "Enterprise",
    });

  // Get the derived Enterprise address.
  const addr = await client.address();
  const addressBech32 = Address.toBech32(addr);
  const addressHex = Address.toHex(addr);

  // Derive the payment private key for CIP-8 message signing.
  // Path: m/1852'/1815'/0'/0/0 (CIP-1852 standard payment key).
  const paymentKey = PrivateKey.fromMnemonicCardano(mnemonic, {
    account: 0,
    role: 0, // payment
    index: 0,
  });

  // signTx: Sign a UVerify-built unsigned transaction.
  // Delegates to the Client which handles body hashing and witness set creation.
  const signTx = async (unsignedCborHex: string): Promise<string> => {
    const witnessSet = await client.signTx(unsignedCborHex);
    return TransactionWitnessSet.toCBORHex(witnessSet);
  };

  // signMessage: CIP-8 COSE message signing for UVerify state operations.
  // Uses COSE.SignData.signData() directly to produce the CIP-30 DataSignature
  // format that UVerify expects: { key: hex(COSE_Key), signature: hex(COSE_Sign1) }.
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
 * Create an evolution-sdk SigningClient for the main wallet.
 * Used for the funding transfer (main wallet → actor wallets).
 * Uses default Base address type since the main wallet already has funds.
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
 * Get the bech32 address of an evolution-sdk client.
 */
export async function getClientAddress(
  client: ReturnType<typeof createMainWalletClient>,
): Promise<string> {
  const addr = await client.address();
  return Address.toBech32(addr);
}
