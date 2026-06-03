/**
 * Payloads DPP para os 4 atores na cadeia de suprimentos de baterias.
 *
 * Cada payload é um Record<string, string> plano registrado na Cardano
 * como metadados de credencial via UVerify. Todos os valores são strings
 * (requisito do UVerify).
 *
 * Cadeia:
 *   Ator 1 (Origem)     → MineraLitio:    extração de lítio
 *   Ator 2 (Celula)     → CellTech:       fabricação de células (ref. Ator 1)
 *   Ator 3 (Pack)       → PackMontadora:  montagem de baterias  (ref. Ator 2)
 *   Ator 4 (Reciclagem) → RecicLar:       reciclagem             (ref. 1, 2, 3)
 */

import { dataHash, hashSerial, mnemonicSuffix } from "./hash.ts";
import type { ActorName, DppPayload, PayloadResult } from "./types.ts";

// ── GTINs (identificadores fixos de tipo de produto) ──────────────────────
const GTIN_ORIGEM = "7891234560099";
const GTIN_CELULA = "7891234560105";
const GTIN_PACK = "7891234560112";
const GTIN_RECICL = "7891234560129";

// ── Prefixos base de serial (sufixo específico do aluno adicionado em tempo de execução) ──
const SERIAL_BASE_ORIGEM = "ML-JQT-2026-05";
const SERIAL_BASE_CELULA = "CT-BA-2026-05";
const SERIAL_BASE_PACK = "PM-SP-2026-05";
const SERIAL_BASE_RECICL = "RL-SR-2031-09";

/**
 * Contexto passado aos construtores de payload: sufixo derivado do mnemonic e
 * hashes de tx de credenciais emitidas anteriormente.
 */
export interface PayloadEnv {
  /** Sufixo hex de 6 caracteres derivado do mnemonic para unicidade do serial. */
  suffix: string;
  /** Hash da tx da emissão do Ator 1 (definido após a emissão da origem). */
  ator1Tx?: string;
  /** Hash da tx da emissão do Ator 2 (definido após a emissão da célula). */
  ator2Tx?: string;
  /** Hash da tx da emissão do Ator 3 (definido após a emissão do pack). */
  ator3Tx?: string;
}

/**
 * Deriva o sufixo do PayloadEnv a partir do mnemonic da carteira principal.
 */
export async function buildPayloadEnv(
  mainMnemonic: string,
): Promise<PayloadEnv> {
  const suffix = await mnemonicSuffix(mainMnemonic);
  return { suffix };
}

// =====================================================================
// Ator 1 — MineraLitio (extração de lítio)
// Primeiro na cadeia. Sem referências a atores anteriores.
// =====================================================================

/**
 * Constrói o payload DPP para o Ator 1 (MineraLitio — extração de lítio).
 *
 * Esta é a primeira credencial na cadeia, portanto não possui campos ref_*.
 * Inclui pureza do lítio, certificações ESG e licença ambiental.
 * O serial é tornado único por execução ao adicionar o sufixo derivado do mnemonic.
 */
async function payloadOrigem(env: PayloadEnv): Promise<PayloadResult> {
  const serial = `${SERIAL_BASE_ORIGEM}-${env.suffix}`;
  const gtin = GTIN_ORIGEM;
  const payload: DppPayload = {
    uverify_template_id: "digitalProductPassport",
    uverify_update_policy: "restricted",
    name: "Lote Litio Jequitinhonha 2026-05",
    issuer: "MineraLitio Jequitinhonha Ltda.",
    gtin,
    uv_url_serial: await hashSerial(serial),
    origin: "Aracuai, Vale do Jequitinhonha, MG, BR",
    manufactured: "2026-03-13",
    contact: "rastreabilidade@mineralitio.example.br",
    carbon_footprint: "4.2 kg CO2e / kg Li2CO3",
    recycled_content: "0%",
    mat_litio_carbonato: "98%",
    mat_impurezas_ferro: "0.3%",
    mat_impurezas_sodio: "0.8%",
    cert_esg_iso14001: "ISO 14001:2015",
    cert_licenca_ambiental: "SUPRAM-JQT-LI-042-2024",
  };
  return { payload, serial, gtin };
}

// =====================================================================
// Ator 2 — CellTech (fabricação de células)
// Referencia o Ator 1 via ref_origem_tx + ref_origem_data_hash.
// =====================================================================

/**
 * Constrói o payload DPP para o Ator 2 (CellTech — fabricação de células NMC 811).
 *
 * Referencia o Ator 1 (origem) via ref_origem_tx e ref_origem_data_hash.
 * Lança erro se ator1Tx não estiver definido (o Ator 1 deve ser emitido primeiro).
 * Calcula o data_hash da origem a partir do mesmo GTIN+serial que o Ator 1 usou,
 * para que o verificador possa cruzar ambas as credenciais.
 */
async function payloadCelula(env: PayloadEnv): Promise<PayloadResult> {
  if (!env.ator1Tx) {
    throw new Error("ATOR1_TX is required before issuing celula");
  }
  const serial = `${SERIAL_BASE_CELULA}-${env.suffix}`;
  const gtin = GTIN_CELULA;
  const serialOrigem = `${SERIAL_BASE_ORIGEM}-${env.suffix}`;
  const payload: DppPayload = {
    uverify_template_id: "digitalProductPassport",
    uverify_update_policy: "restricted",
    name: `Celulas NMC 811 - Lote BA-2026-05-${env.suffix}`,
    issuer: "CellTech Brasil S.A.",
    gtin,
    uv_url_serial: await hashSerial(serial),
    origin: "Camacari, BA, BR",
    manufactured: "2026-05-08",
    contact: "qualidade@celltech.example.br",
    carbon_footprint: "68 kg CO2e / kWh",
    recycled_content: "4%",
    energy_class: "NMC 811 - 270 Wh/kg",
    warranty: "8 anos / 160.000 km no veiculo final",
    mat_niquel: "80%",
    mat_manganes: "10%",
    mat_cobalto: "10%",
    mat_litio_origem: "MineraLitio Jequitinhonha",
    cert_iso9001: "ISO 9001:2015",
    cert_iatf16949: "IATF 16949:2016",
    ref_origem_tx: env.ator1Tx,
    ref_origem_data_hash: await dataHash(GTIN_ORIGEM, serialOrigem),
  };
  return { payload, serial, gtin };
}

// =====================================================================
// Ator 3 — PackMontadora (montagem de pack de baterias)
// Referencia o Ator 2 via ref_celula_tx + ref_celula_data_hash.
// =====================================================================

/**
 * Constrói o payload DPP para o Ator 3 (PackMontadora — montagem de pack de baterias).
 *
 * Referencia o Ator 2 (célula) via ref_celula_tx e ref_celula_data_hash.
 * Lança erro se ator2Tx não estiver definido (o Ator 2 deve ser emitido primeiro).
 * Este é tipicamente o ponto de entrada para verificação (DATA_HASH_PACK).
 */
async function payloadPack(env: PayloadEnv): Promise<PayloadResult> {
  if (!env.ator2Tx) {
    throw new Error("ATOR2_TX is required before issuing pack");
  }
  const serial = `${SERIAL_BASE_PACK}-${env.suffix}`;
  const gtin = GTIN_PACK;
  const serialCelula = `${SERIAL_BASE_CELULA}-${env.suffix}`;
  const payload: DppPayload = {
    uverify_template_id: "digitalProductPassport",
    uverify_update_policy: "restricted",
    name: `Pack EV 75kWh - SP-2026-05-${env.suffix}`,
    issuer: "PackMontadora SP Ltda.",
    gtin,
    uv_url_serial: await hashSerial(serial),
    origin: "Sao Bernardo do Campo, SP, BR",
    manufactured: "2026-05-22",
    contact: "pcp@packmontadora.example.br",
    carbon_footprint: "72 kg CO2e / kWh (cradle-to-gate)",
    recycled_content: "6%",
    energy_class: "75 kWh utilizaveis / 82 kWh nominais",
    warranty: "8 anos ou 160.000 km",
    spare_parts: "Modulos individuais disponiveis ate 2038",
    mat_celulas: "88%",
    mat_bms: "3%",
    mat_carcaca_aluminio: "7%",
    mat_cabos_cobre: "2%",
    cert_un38_3: "UN 38.3 - transporte",
    cert_iec62660: "IEC 62660-2/3",
    ref_celula_tx: env.ator2Tx,
    ref_celula_data_hash: await dataHash(GTIN_CELULA, serialCelula),
  };
  return { payload, serial, gtin };
}

// =====================================================================
// Ator 4 — RecicLar (reciclagem)
// Referencia todos os 3 atores anteriores para rastreabilidade reversa completa.
// =====================================================================

/**
 * Constrói o payload DPP para o Ator 4 (RecicLar — reciclagem em fim de vida).
 *
 * Referencia todos os 3 atores anteriores (origem, célula, pack) via ref_*_tx
 * e campos ref_*_data_hash. Isso fornece rastreabilidade reversa completa
 * da reciclagem até a extração de lítio bruto.
 * Lança erro se qualquer um dos 3 hashes de tx pré-requisitos estiver ausente.
 */
async function payloadReciclagem(env: PayloadEnv): Promise<PayloadResult> {
  if (!env.ator1Tx || !env.ator2Tx || !env.ator3Tx) {
    throw new Error(
      "ATOR1_TX, ATOR2_TX, and ATOR3_TX are all required before issuing reciclagem",
    );
  }
  const serial = `${SERIAL_BASE_RECICL}-${env.suffix}`;
  const gtin = GTIN_RECICL;
  const serialOrigem = `${SERIAL_BASE_ORIGEM}-${env.suffix}`;
  const serialCelula = `${SERIAL_BASE_CELULA}-${env.suffix}`;
  const serialPack = `${SERIAL_BASE_PACK}-${env.suffix}`;
  const payload: DppPayload = {
    uverify_template_id: "digitalProductPassport",
    uverify_update_policy: "restricted",
    name: `Reciclagem Pack 75kWh - SR-2031-09-${env.suffix}`,
    issuer: "RecicLar Sorocaba S.A.",
    gtin,
    uv_url_serial: await hashSerial(serial),
    origin: "Sorocaba, SP, BR",
    manufactured: "2031-09-17",
    contact: "logreversa@reciclar.example.br",
    recycled_content: "N/A (processo de reciclagem)",
    mat_litio_recuperado: "3.8 kg",
    mat_niquel_recuperado: "38 kg",
    mat_cobalto_recuperado: "4.6 kg",
    mat_cobre_recuperado: "9.2 kg",
    ref_pack_tx: env.ator3Tx,
    ref_pack_data_hash: await dataHash(GTIN_PACK, serialPack),
    ref_celula_tx: env.ator2Tx,
    ref_celula_data_hash: await dataHash(GTIN_CELULA, serialCelula),
    ref_origem_tx: env.ator1Tx,
    ref_origem_data_hash: await dataHash(GTIN_ORIGEM, serialOrigem),
  };
  return { payload, serial, gtin };
}

// =====================================================================
// Registro: nome do ator → construtor de payload
// =====================================================================

type PayloadBuilder = (env: PayloadEnv) => Promise<PayloadResult>;

export const PAYLOAD_BUILDERS: Record<ActorName, PayloadBuilder> = {
  origem: payloadOrigem,
  celula: payloadCelula,
  pack: payloadPack,
  reciclagem: payloadReciclagem,
};
