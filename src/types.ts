/**
 * Type definitions for the DPP pipeline.
 */

/** The four actors in the battery supply chain. */
export type ActorName = "origem" | "celula" | "pack" | "reciclagem";

/** Emission mode: UVerify smart contracts or direct native metadata. */
export type EmissionMode = "uverify" | "metadata";

/** Maps actor name to the .env variable that stores its tx hash. */
export const ACTOR_ENV_KEY: Record<ActorName, string> = {
  origem: "ATOR1_TX",
  celula: "ATOR2_TX",
  pack: "ATOR3_TX",
  reciclagem: "ATOR4_TX",
};

/** Ordered list of actors for sequential issuance. */
export const ACTOR_ORDER: ActorName[] = [
  "origem",
  "celula",
  "pack",
  "reciclagem",
];

/** A wallet generated for one actor. */
export interface ActorWallet {
  name: ActorName;
  mnemonic: string;
  address: string;
  /** Signs a CBOR-hex unsigned tx, returns witness set CBOR-hex. */
  signTx: (unsignedCborHex: string) => Promise<string>;
  /** CIP-8 message signing for UVerify state operations. */
  signMessage: (message: string) => Promise<{ key: string; signature: string }>;
  /** Evolution SDK signing client for direct tx building (metadata mode). */
  // deno-lint-ignore no-explicit-any
  client: any;
}

/** Result of issuing one credential. */
export interface IssuanceResult {
  actor: ActorName;
  txHash: string;
  dataHash: string;
}

/** Loaded and validated pipeline configuration. */
export interface PipelineConfig {
  blockfrostProjectId: string;
  mainWalletMnemonic: string;
  uverifyApiUrl: string;
  blockfrostBaseUrl: string;
  emissionMode: EmissionMode;
}

/** DPP payload: all values are strings (UVerify requirement). */
export type DppPayload = Record<string, string>;

/** Return type from payload builder functions. */
export interface PayloadResult {
  payload: DppPayload;
  serial: string;
  gtin: string;
}
