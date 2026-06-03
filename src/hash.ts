/**
 * Utilitários de hash SHA-256 usando a Web Crypto API.
 *
 * - dataHash(gtin, serial) → sha256(gtin + serial) — impressão digital do produto
 * - hashSerial(serial)     → sha256(serial) — serial com preservação de privacidade
 * - mnemonicSuffix(mnemonic) → primeiros 6 caracteres hex de sha256(mnemonic)
 */

/** Converte um Uint8Array para string hexadecimal. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Hash SHA-256 de uma string UTF-8, retornado como hex. */
async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(hashBuffer));
}

/**
 * Impressão digital do produto: sha256(gtin + serial).
 * Usado pelo UVerify para indexar e buscar certificados on-chain.
 */
export async function dataHash(gtin: string, serial: string): Promise<string> {
  return sha256hex(gtin + serial);
}

/**
 * Hash do serial com preservação de privacidade: sha256(serial).
 * O serial real nunca vai para a blockchain — apenas o hash.
 */
export async function hashSerial(serial: string): Promise<string> {
  return sha256hex(serial);
}

/**
 * Deriva um sufixo hex determinístico de 6 caracteres a partir do mnemonic da carteira principal.
 * Garante que cada carteira tenha um namespace de serial único.
 */
export async function mnemonicSuffix(mnemonic: string): Promise<string> {
  const full = await sha256hex(mnemonic);
  return full.slice(0, 6);
}
