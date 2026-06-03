/**
 * Relatório HTML de certificado de reciclagem.
 *
 * Gera um relatório HTML autocontido para a credencial de reciclagem
 * emitida pelo Ator 4 (RecicLar). Apresenta esquema de cores em teal,
 * diagrama de fluxo do ciclo de vida, seção de materiais recuperados
 * e rastreabilidade reversa.
 *
 * Porta do Python `RelatorioReciclagemHTML`.
 */

import type { DppPayload } from "../types.ts";
import {
  CHEVRON_SVG,
  cexplorerLink,
  escapeHtml,
  ICON_CHAIN,
  ICON_RECYCLE_HEADER,
  openHtmlInBrowser,
  VERIFIED_CHECK_SVG,
} from "./html-utils.ts";

const ICON_RECYCLE_CARD =
  '<svg viewBox="0 0 24 24" class="card-icon" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
  '<path d="M21 3v5h-5"/>' +
  '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
  '<path d="M3 21v-5h5"/>' +
  "</svg>";

export interface ReciclagemReportInput {
  payload: DppPayload;
  txHash: string;
  dataHash: string;
}

/** Folha de estilos em teal para o relatório de reciclagem. */
function reciclagemStylesheet(): string {
  return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    background: #f5f5f5;
    color: #333;
    line-height: 1.6;
}
.header {
    background: linear-gradient(135deg, #004d40, #00695c);
    color: #fff;
    padding: 3rem 1rem 2.5rem;
    text-align: center;
    position: relative;
    overflow: hidden;
}
.header::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: repeating-linear-gradient(
        45deg,
        transparent,
        transparent 10px,
        rgba(255,255,255,0.03) 10px,
        rgba(255,255,255,0.03) 20px
    );
    pointer-events: none;
}
.header-icon {
    width: 48px;
    height: 48px;
    margin-bottom: 0.5rem;
    opacity: 0.9;
    color: #fff;
}
.header-pretitle {
    display: block;
    font-size: 0.7rem;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    opacity: 0.7;
    margin-bottom: 0.6rem;
    font-weight: 500;
    position: relative;
}
.header h1 {
    font-size: 1.8rem;
    margin-bottom: 0.5rem;
    font-weight: 700;
    position: relative;
}
.header p {
    font-size: 1rem;
    opacity: 0.75;
    font-weight: 300;
    letter-spacing: 0.02em;
    position: relative;
}
.container {
    max-width: 860px;
    margin: 0 auto;
    padding: 1.5rem 1rem 2rem;
}
.flow {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin: 1.5rem 0 2rem;
    flex-wrap: wrap;
    position: relative;
}
.flow-step {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.2rem;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.95rem;
    color: #fff;
    position: relative;
    z-index: 1;
}
.flow-step.pack        { background: #f9a825; color: #333; }
.flow-step.desmontagem { background: #00897b; }
.flow-step.reciclagem  { background: #004d40; }
.step-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(255,255,255,0.25);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
    flex-shrink: 0;
}
.flow-step.pack .step-number {
    background: rgba(0,0,0,0.12);
}
.flow-arrow {
    display: inline-flex;
    align-items: center;
    margin: 0 0.3rem;
    color: #999;
}
.card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    margin-bottom: 1.5rem;
    overflow: hidden;
}
.card-border {
    border-left: 6px solid;
}
.card-header-strip {
    height: 4px;
    width: 100%;
}
.card-header {
    padding: 1rem 1.2rem 0.6rem;
    font-size: 1.15rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    position: relative;
}
.card-icon {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    color: #555;
}
.card-body {
    padding: 0 1.2rem 1.2rem;
}
.card-body dl {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 0;
}
.card-body dt,
.card-body dd {
    padding: 0.3rem 0.5rem;
    font-size: 0.9rem;
    margin: 0;
}
.card-body dt {
    font-weight: 600;
    color: #555;
}
.card-body dt:nth-of-type(even),
.card-body dd:nth-of-type(even) {
    background: rgba(0,0,0,0.025);
}
.materials {
    margin-top: 0.8rem;
}
.materials h4 {
    font-size: 0.9rem;
    font-weight: 600;
    color: #555;
    margin-bottom: 0.4rem;
}
.mat-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}
.mat-tag {
    background: #e0f2f1;
    padding: 0.3rem 0.8rem 0.3rem 0.6rem;
    border-radius: 20px;
    font-size: 0.82rem;
    color: #333;
    box-shadow: 0 1px 3px rgba(0,0,0,0.07);
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
}
.mat-tag::before {
    content: "";
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #00897b;
    flex-shrink: 0;
}
.rastreabilidade {
    margin-top: 1rem;
}
.rastreabilidade h4 {
    font-size: 0.9rem;
    font-weight: 600;
    color: #555;
    margin-bottom: 0.4rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
}
.section-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    color: #00897b;
}
.ref-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}
.ref-badge {
    display: inline-block;
    background: #e0f2f1;
    border: 1px solid #80cbc4;
    border-left: 3px solid #00897b;
    border-radius: 6px;
    padding: 0.4rem 0.9rem;
    font-size: 0.82rem;
    color: #004d40;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.ref-badge strong {
    font-weight: 700;
    margin-right: 0.3rem;
}
.ref-badge a {
    color: #004d40;
    text-decoration: none;
}
.ref-badge a:hover {
    text-decoration: underline;
    color: #00897b;
}
.card-tx {
    padding: 0.2rem 1.2rem 0.4rem;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.78rem;
    color: #888;
}
.card-tx a {
    color: #00897b;
    text-decoration: none;
}
.card-tx a:hover {
    text-decoration: underline;
    color: #004d40;
}
.verified-banner {
    background: linear-gradient(135deg, #e8f5e9, #c8e6c9);
    border: 2px solid #43a047;
    border-radius: 12px;
    padding: 1.5rem 1.2rem;
    margin: 2rem 0 1rem;
    text-align: center;
    position: relative;
    overflow: hidden;
}
.verified-banner::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: repeating-linear-gradient(
        45deg,
        transparent,
        transparent 10px,
        rgba(46,125,50,0.03) 10px,
        rgba(46,125,50,0.03) 20px
    );
    pointer-events: none;
}
.verified-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    margin-bottom: 0.8rem;
    position: relative;
}
.verified-badge svg {
    width: 64px;
    height: 64px;
}
.verified-pretitle {
    font-size: 0.7rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #388e3c;
    font-weight: 600;
    margin-bottom: 0.3rem;
    position: relative;
}
.verified-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: #2e7d32;
    margin-bottom: 0.3rem;
    position: relative;
}
.verified-subtitle {
    font-size: 0.92rem;
    color: #555;
    margin-bottom: 0.6rem;
    position: relative;
}
.verified-chain {
    display: inline-block;
    background: #fff;
    border: 1px solid #a5d6a7;
    border-radius: 6px;
    padding: 0.4rem 1rem;
    font-size: 0.82rem;
    color: #666;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    position: relative;
}
.footer {
    text-align: center;
    padding: 1.5rem 1rem;
    color: #777;
    font-size: 0.85rem;
    border-top: 1px solid #e0e0e0;
    margin-top: 1rem;
}
.footer-protocol {
    font-size: 0.78rem;
    color: #999;
    margin-top: 0.3rem;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
@media (max-width: 600px) {
    .header h1 { font-size: 1.3rem; }
    .card-body dl {
        grid-template-columns: 1fr;
    }
    .card-body dt {
        margin-top: 0.3rem;
    }
    .flow {
        flex-direction: column;
    }
    .flow-arrow {
        transform: rotate(90deg);
    }
}`;
}

/** Constrói o conteúdo do corpo do card a partir do payload. */
function buildBody(payload: DppPayload, txHash: string): string {
  const esc = escapeHtml;

  // Link da tx
  const txLinkHtml =
    `        <div class="card-tx">Tx: ${cexplorerLink(txHash)}</div>\n`;

  // Campos padrão
  const campos: [string, string | undefined][] = [
    ["Emitente", payload["issuer"]],
    ["Produto", payload["name"]],
    ["GTIN", payload["gtin"]],
    ["Local", payload["origin"]],
    ["Data de processamento", payload["manufactured"]],
    ["Pegada de carbono", payload["carbon_footprint"]],
    ["Conteudo reciclado", payload["recycled_content"]],
  ];

  const dlItems: string[] = [];
  for (const [rotulo, valor] of campos) {
    if (valor === undefined) continue;
    const valorStr = String(valor).trim();
    if (!valorStr) continue;
    dlItems.push(
      `            <dt>${esc(rotulo)}</dt><dd>${esc(valorStr)}</dd>`,
    );
  }
  const dlHtml = dlItems.join("\n");

  // Materiais recuperados
  let materiaisHtml = "";
  const mats: [string, string][] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k.startsWith("mat_")) {
      mats.push([k.slice(4), String(v)]);
    }
  }
  if (mats.length > 0) {
    const tags = mats
      .map(
        ([k, v]) =>
          `                <span class="mat-tag">${esc(k)}: ${esc(v)}</span>`,
      )
      .join("\n");
    materiaisHtml =
      '        <div class="materials">\n' +
      "            <h4>Materiais Recuperados</h4>\n" +
      '            <div class="mat-tags">\n' +
      `${tags}\n` +
      "            </div>\n" +
      "        </div>\n";
  }

  // Rastreabilidade reversa
  let rastreabilidadeHtml = "";
  const labelMap: Record<string, string> = {
    pack: "Pack",
    celula: "C\u00e9lula",
    origem: "Origem",
  };
  const refs: [string, string][] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k.startsWith("ref_") && k.endsWith("_tx")) {
      refs.push([k.slice(4), String(v)]);
    }
  }
  if (refs.length > 0) {
    const badges = refs.map(([chave, refTx]) => {
      const nome = chave.replace("_tx", "");
      const label = labelMap[nome] ?? nome;
      const hashHtml = cexplorerLink(refTx);
      return (
        `                <span class="ref-badge">` +
        `<strong>${esc(label)}</strong>${hashHtml}</span>`
      );
    });
    rastreabilidadeHtml =
      '        <div class="rastreabilidade">\n' +
      `            <h4>${ICON_CHAIN}Rastreabilidade Reversa</h4>\n` +
      '            <div class="ref-badges">\n' +
      `${badges.join("\n")}\n` +
      "            </div>\n" +
      "        </div>\n";
  }

  const card =
    '    <div class="card card-border" style="border-left-color:#00695c">\n' +
    '        <div class="card-header-strip" style="background:#00695c"></div>\n' +
    `        <div class="card-header">${ICON_RECYCLE_CARD}Reciclagem de Bateria EV</div>\n` +
    txLinkHtml +
    '        <div class="card-body">\n' +
    "            <dl>\n" +
    `${dlHtml}\n` +
    "            </dl>\n" +
    materiaisHtml +
    rastreabilidadeHtml +
    "        </div>\n" +
    "    </div>";

  const banner =
    '    <div class="verified-banner">\n' +
    '        <div class="verified-badge">\n' +
    `            ${VERIFIED_CHECK_SVG}\n` +
    "        </div>\n" +
    '        <div class="verified-pretitle">Certificado Verificado</div>\n' +
    '        <div class="verified-title">Certificado de reciclagem verificado na Blockchain Cardano</div>\n' +
    '        <div class="verified-subtitle">\n' +
    "            Cadeia reversa completa: este certificado de reciclagem\n" +
    "            referencia todas as etapas anteriores da cadeia de suprimentos.\n" +
    "        </div>\n" +
    '        <div class="verified-chain">Rede: Cardano Preprod &bull; Template: Digital Product Passport</div>\n' +
    "    </div>";

  return `${card}\n${banner}`;
}

/** Gera o relatório HTML autocontido de reciclagem. */
export function generateReciclagemReport(input: ReciclagemReportInput): string {
  const corpo = buildBody(input.payload, input.txHash);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Certificado de Fim de Vida &mdash; Reciclagem de Bateria EV</title>
<style>
${reciclagemStylesheet()}
</style>
</head>
<body>
<div class="header">
    ${ICON_RECYCLE_HEADER}
    <span class="header-pretitle">Certificado Digital</span>
    <h1>Certificado de Fim de Vida &mdash; Reciclagem de Bateria EV</h1>
    <p>Workshop Cardano &mdash; De Jequitinhonha a Europa</p>
</div>
<div class="container">
    <div class="flow">
        <div class="flow-step pack"><span class="step-number">1</span>Pack</div>
        <span class="flow-arrow">${CHEVRON_SVG}</span>
        <div class="flow-step desmontagem"><span class="step-number">2</span>Desmontagem</div>
        <span class="flow-arrow">${CHEVRON_SVG}</span>
        <div class="flow-step reciclagem"><span class="step-number">3</span>Reciclagem</div>
    </div>
${corpo}
    <div class="footer">
        Certificado de reciclagem verificado on-chain &mdash; cadeia reversa completa.
        <div class="footer-protocol">Template DPP &bull; Rede Cardano Preprod</div>
    </div>
</div>
</body>
</html>`;
}

/** Gera e abre o relatório de reciclagem no navegador. */
export async function openReciclagemReport(
  input: ReciclagemReportInput,
): Promise<string> {
  const html = generateReciclagemReport(input);
  const path = await openHtmlInBrowser(html, "dpp-reciclagem");
  console.log(`  Reciclagem report opened: ${path}`);
  return path;
}
