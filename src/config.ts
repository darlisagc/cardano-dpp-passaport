/**
 * Configuração de ambiente — carrega e valida variáveis .env.
 */

import "@std/dotenv/load";
import type { EmissionMode, PipelineConfig } from "./types.ts";

/**
 * Carrega e valida a configuração do pipeline a partir das variáveis .env.
 *
 * Variáveis obrigatórias:
 *   - BLOCKFROST_PROJECT_ID: chave de API Blockfrost para preprod (rejeita placeholders e chaves de mainnet)
 *   - WALLET_MNEMONIC: mnemonic BIP-39 de 24 palavras para a carteira principal de financiamento
 *
 * Variáveis opcionais:
 *   - UVERIFY_API_URL: URL base da API UVerify (padrão: preprod)
 *   - EMISSION_MODE: "uverify" (padrão) ou "metadata"
 *
 * Lança erros descritivos se variáveis obrigatórias estiverem ausentes ou inválidas.
 */
export function loadConfig(): PipelineConfig {
  const blockfrostProjectId = Deno.env.get("BLOCKFROST_PROJECT_ID")?.trim();
  if (!blockfrostProjectId || blockfrostProjectId.startsWith("preprodXXXX")) {
    throw new Error(
      "BLOCKFROST_PROJECT_ID is required in .env. " +
        "Get one at https://blockfrost.io/",
    );
  }

  const mainWalletMnemonic = Deno.env.get("WALLET_MNEMONIC")?.trim();
  if (!mainWalletMnemonic) {
    throw new Error(
      "WALLET_MNEMONIC is required in .env (24 words, TESTNET ONLY)",
    );
  }

  const words = mainWalletMnemonic.split(/\s+/);
  if (words.length !== 24) {
    throw new Error(
      `WALLET_MNEMONIC must be 24 words, got ${words.length}`,
    );
  }

  const uverifyApiUrl =
    Deno.env.get("UVERIFY_API_URL")?.trim() ||
    "https://api.preprod.uverify.io";

  const blockfrostBaseUrl = "https://cardano-preprod.blockfrost.io/api/v0";

  const rawMode = Deno.env.get("EMISSION_MODE")?.trim().toLowerCase() || "uverify";
  if (rawMode !== "uverify" && rawMode !== "metadata") {
    throw new Error(
      `EMISSION_MODE must be "uverify" or "metadata", got "${rawMode}"`,
    );
  }
  const emissionMode: EmissionMode = rawMode;

  return {
    blockfrostProjectId,
    mainWalletMnemonic,
    uverifyApiUrl,
    blockfrostBaseUrl,
    emissionMode,
  };
}
