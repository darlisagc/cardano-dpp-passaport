/**
 * HTML emission receipt — generated after each credential issuance.
 *
 * Generates a self-contained HTML page (receipt) showing the data of the
 * newly issued credential, with clickable Cexplorer preprod links.
 *
 * Port of Python `RelatorioEmissaoHTML`.
 */

import type { ActorName, DppPayload } from "../types.ts";
import {
  ACTOR_CONFIG,
  baseStylesheet,
  cexplorerLink,
  escapeHtml,
  ICON_BATTERY_HEADER,
  openHtmlInBrowser,
  VERIFIED_CHECK_SVG,
} from "./html-utils.ts";

export interface EmissionReceiptInput {
  actor: ActorName;
  payload: DppPayload;
  txHash: string;
  dataHash: string;
}

/** Generate the standard field rows (<dt>/<dd>) for the payload. */
function buildFields(payload: DppPayload): string {
  const fieldMap: [string, string][] = [
    ["name", "Produto"],
    ["issuer", "Emitente"],
    ["gtin", "GTIN"],
    ["data_hash", "Data Hash"],
    ["origin", "Origem"],
    ["manufactured", "Fabricado em"],
    ["carbon_footprint", "Pegada de carbono"],
    ["recycled_content", "Conteudo reciclado"],
  ];
  const items: string[] = [];
  for (const [key, label] of fieldMap) {
    const valor = payload[key];
    if (valor === undefined || valor === null) continue;
    const valorStr = String(valor).trim();
    if (!valorStr) continue;
    items.push(
      `                <dt>${escapeHtml(label)}</dt>` +
        `<dd>${escapeHtml(valorStr)}</dd>`,
    );
  }
  return items.join("\n");
}

/** Generate the materials section (mat_* fields). */
function buildMaterials(payload: DppPayload): string {
  const mats: [string, string][] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k.startsWith("mat_")) {
      mats.push([k.slice(4), String(v)]);
    }
  }
  if (mats.length === 0) return "";

  const tags = mats
    .map(
      ([k, v]) =>
        `                <span class="mat-tag">` +
        `${escapeHtml(k)}: ${escapeHtml(v)}</span>`,
    )
    .join("\n");

  return (
    '            <div class="materials">\n' +
    "                <h4>Materiais</h4>\n" +
    '                <div class="mat-tags">\n' +
    `${tags}\n` +
    "                </div>\n" +
    "            </div>\n"
  );
}

/** Generate the references section (ref_*_tx fields). */
function buildReferences(payload: DppPayload): string {
  const labelMap: Record<string, string> = {
    pack: "Pack",
    celula: "Celula",
    origem: "Origem",
  };

  const refs: [string, string][] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k.startsWith("ref_") && k.endsWith("_tx")) {
      refs.push([k.slice(4), String(v)]);
    }
  }
  if (refs.length === 0) return "";

  const badges = refs.map(([chave, refTx]) => {
    const nome = chave.replace("_tx", "");
    const label = labelMap[nome] ?? nome;
    const short = refTx.length > 16 ? refTx.slice(0, 16) + "..." : refTx;
    const url = `https://preprod.cexplorer.io/tx/${escapeHtml(refTx)}`;
    return (
      `                <span class="ref-badge">` +
      `<strong>${escapeHtml(label)}</strong>` +
      `<a href="${url}" target="_blank" ` +
      `rel="noopener noreferrer" title="${escapeHtml(refTx)}">` +
      `${escapeHtml(short)}</a></span>`
    );
  });

  return (
    '            <div class="referencias">\n' +
    "                <h4>Referencias na Cadeia</h4>\n" +
    '                <div class="ref-badges">\n' +
    `${badges.join("\n")}\n` +
    "                </div>\n" +
    "            </div>\n"
  );
}

/** Generate the self-contained HTML emission receipt. */
export function generateEmissionReceipt(input: EmissionReceiptInput): string {
  const cfg = ACTOR_CONFIG[input.actor];
  const camposHtml = buildFields(input.payload);
  const materiaisHtml = buildMaterials(input.payload);
  const referenciasHtml = buildReferences(input.payload);
  const cexplorerUrl = `https://preprod.cexplorer.io/tx/${escapeHtml(input.txHash)}`;
  const shortTx =
    input.txHash.length > 20
      ? input.txHash.slice(0, 20) + "..."
      : input.txHash;
  const esc = escapeHtml;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Emissao DPP \u2014 ${esc(cfg.titulo)}</title>
<style>
${baseStylesheet(cfg.corHeaderFrom, cfg.corHeaderTo, cfg.corCard)}
</style>
</head>
<body>
<div class="header">
    ${ICON_BATTERY_HEADER}
    <span class="header-pretitle">Emissao DPP \u2014 Certificado Registrado</span>
    <h1>${esc(cfg.titulo)}</h1>
    <p>${esc(cfg.subtitulo)}</p>
</div>
<div class="container">
    <div class="card">
        <div class="card-header-strip"></div>
        <div class="card-header">${cfg.icon}${esc(cfg.titulo)}</div>
        <div class="card-tx">Tx: <a href="${cexplorerUrl}" target="_blank" rel="noopener noreferrer" title="${esc(input.txHash)}">${esc(shortTx)}</a></div>
        <div class="card-body">
            <dl>
${camposHtml}
            </dl>
${materiaisHtml}${referenciasHtml}
        </div>
    </div>
    <div class="hashes">
        <strong>tx_hash:</strong> <a href="${cexplorerUrl}" target="_blank" rel="noopener noreferrer">${esc(input.txHash)}</a><br>
        <strong>data_hash:</strong> ${esc(input.dataHash)}
    </div>
    <div class="verified-banner">
        <div class="verified-badge">
            ${VERIFIED_CHECK_SVG}
        </div>
        <div class="verified-pretitle">Emissao Registrada</div>
        <div class="verified-title">Emissao registrada na Blockchain Cardano</div>
        <div class="verified-subtitle">
            Este certificado DPP foi ancorado on-chain na rede Cardano preprod.
        </div>
        <div class="verified-chain">Rede: Cardano Preprod &bull; Template: Digital Product Passport</div>
    </div>
    <div class="footer">
        Certificado emitido e registrado on-chain.
        <div class="footer-protocol">Template DPP &bull; Rede Cardano Preprod</div>
    </div>
</div>
</body>
</html>`;
}

/** Generate and open the emission receipt in the browser. */
export async function openEmissionReceipt(
  input: EmissionReceiptInput,
): Promise<string> {
  const html = generateEmissionReceipt(input);
  const path = await openHtmlInBrowser(html, `dpp-emissao-${input.actor}`);
  console.log(`  Receipt opened: ${path}`);
  return path;
}
