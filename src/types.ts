/**
 * Definições de tipos para o pipeline DPP.
 */

/** Os quatro atores na cadeia de suprimentos de baterias. */
export type ActorName = "origem" | "celula" | "pack" | "reciclagem";

/** Modo de emissão: contratos inteligentes UVerify ou metadados nativos diretos. */
export type EmissionMode = "uverify" | "metadata";

/** Mapeia o nome do ator para a variável .env que armazena o hash da tx. */
export const ACTOR_ENV_KEY: Record<ActorName, string> = {
  origem: "ATOR1_TX",
  celula: "ATOR2_TX",
  pack: "ATOR3_TX",
  reciclagem: "ATOR4_TX",
};

/** Lista ordenada de atores para emissão sequencial. */
export const ACTOR_ORDER: ActorName[] = [
  "origem",
  "celula",
  "pack",
  "reciclagem",
];

/** Uma carteira gerada para um ator. */
export interface ActorWallet {
  name: ActorName;
  mnemonic: string;
  address: string;
  /** Assina uma tx CBOR-hex não assinada, retorna o conjunto de testemunhas CBOR-hex. */
  signTx: (unsignedCborHex: string) => Promise<string>;
  /** Assinatura de mensagens CIP-8 para operações de estado do UVerify. */
  signMessage: (message: string) => Promise<{ key: string; signature: string }>;
  /** Cliente de assinatura do SDK Evolution para construção direta de tx (modo metadata). */
  // deno-lint-ignore no-explicit-any
  client: any;
}

/** Resultado da emissão de uma credencial. */
export interface IssuanceResult {
  actor: ActorName;
  txHash: string;
  dataHash: string;
}

/** Configuração do pipeline carregada e validada. */
export interface PipelineConfig {
  blockfrostProjectId: string;
  mainWalletMnemonic: string;
  uverifyApiUrl: string;
  blockfrostBaseUrl: string;
  emissionMode: EmissionMode;
}

/** Payload DPP: todos os valores são strings (requisito do UVerify). */
export type DppPayload = Record<string, string>;

/** Tipo de retorno das funções construtoras de payload. */
export interface PayloadResult {
  payload: DppPayload;
  serial: string;
  gtin: string;
}
