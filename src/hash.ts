/**
 * SHA-256 hashing helpers using Web Crypto API.
 *
 * - dataHash(gtin, serial) → sha256(gtin + serial) — product fingerprint
 * - hashSerial(serial)     → sha256(serial) — privacy-preserving serial
 * - mnemonicSuffix(mnemonic) → first 6 hex chars of sha256(mnemonic)
 */

/** Convert a Uint8Array to hex string. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hash of a UTF-8 string, returned as hex. */
async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(hashBuffer));
}

/**
 * Product fingerprint: sha256(gtin + serial).
 * Used by UVerify to index and look up certificates on-chain.
 */
export async function dataHash(gtin: string, serial: string): Promise<string> {
  return sha256hex(gtin + serial);
}

/**
 * Privacy-preserving serial hash: sha256(serial).
 * The actual serial never goes on-chain — only the hash.
 */
export async function hashSerial(serial: string): Promise<string> {
  return sha256hex(serial);
}

/**
 * Derive a deterministic 6-char hex suffix from the main wallet mnemonic.
 * Ensures each wallet gets a unique serial namespace.
 */
export async function mnemonicSuffix(mnemonic: string): Promise<string> {
  const full = await sha256hex(mnemonic);
  return full.slice(0, 6);
}
