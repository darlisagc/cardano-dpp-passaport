/**
 * HTML verification report — full supply chain passport.
 *
 * Generates a self-contained HTML report showing all verified credentials
 * in the supply chain (origem -> celula -> pack -> optional reciclagem),
 * with supply chain flow diagram and color-coded cards.
 *
 * Port of Python `RelatorioHTML`.
 */

import type { VerifiedCredential } from "../verify.ts";
import {
  CARD_ICONS,
  CHEVRON_SVG,
  cexplorerLink,
  escapeHtml,
  ICON_BATTERY_HEADER,
  ICON_CHAIN_LINK,
  ICON_SHIELD_CHECK,
  openHtmlInBrowser,
  VERIFIED_CHECK_SVG,
} from "./html-utils.ts";

export interface VerificationReportInput {
  origem?: VerifiedCredential;
  celula?: VerifiedCredential;
  pack?: VerifiedCredential;
  reciclagem?: VerifiedCredential;
}

/** Generate the emission method badge. */
function emissionBadge(metodo?: string): string {
  if (metodo === "metadata") {
    return `<span class="emission-badge metadata">${ICON_CHAIN_LINK}Metadata</span>`;
  }
  if (metodo === "uverify") {
    return `<span class="emission-badge uverify">${ICON_SHIELD_CHECK}UVerify</span>`;
  }
  return "";
}

/** Generate a single credential card. */
function buildCard(
  titulo: string,
  cred: VerifiedCredential | undefined,
  cor: string,
  tipo: string,
): string {
  const esc = escapeHtml;
  const iconHtml = CARD_ICONS[tipo as keyof typeof CARD_ICONS] ?? "";

  if (!cred) {
    return (
      `    <div class="card card-border" style="border-left-color:${cor}">\n` +
      `        <div class="card-header-strip" style="background:${cor}"></div>\n` +
      `        <div class="card-header">${iconHtml}${esc(titulo)}</div>\n` +
      `        <div class="card-absent">(credencial ausente ou nao encontrada na cadeia)</div>\n` +
      `    </div>`
    );
  }

  const badgeHtml = emissionBadge();

  let txLinkHtml = "";
  if (cred.txHash) {
    txLinkHtml =
      `        <div class="card-tx">Tx: ${cexplorerLink(cred.txHash)}</div>\n`;
  }

  const campos: [string, string | undefined][] = [
    ["Emitente", cred.issuer],
    ["Produto", cred.name],
    ["GTIN", cred.gtin],
    ["Origem", cred.origin],
    ["Fabricado em", cred.manufactured],
    ["Pegada de carbono", cred.carbonFootprint],
    ["Conteudo reciclado", cred.recycledContent],
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

  let materiaisHtml = "";
  if (cred.materials && Object.keys(cred.materials).length > 0) {
    const tags = Object.entries(cred.materials)
      .map(
        ([k, v]) =>
          `                <span class="mat-tag">${esc(k.replace(/^mat_/, ""))}: ${esc(v)}</span>`,
      )
      .join("\n");
    materiaisHtml =
      '        <div class="materials">\n' +
      "            <h4>Materiais</h4>\n" +
      '            <div class="mat-tags">\n' +
      `${tags}\n` +
      "            </div>\n" +
      "        </div>\n";
  }

  return (
    `    <div class="card card-border" style="border-left-color:${cor}">\n` +
    `        <div class="card-header-strip" style="background:${cor}"></div>\n` +
    `        <div class="card-header">${iconHtml}${esc(titulo)}${badgeHtml}</div>\n` +
    txLinkHtml +
    '        <div class="card-body">\n' +
    "            <dl>\n" +
    `${dlHtml}\n` +
    "            </dl>\n" +
    materiaisHtml +
    "        </div>\n" +
    "    </div>"
  );
}

/** Verification report stylesheet. */
function verificationStylesheet(): string {
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
    background: linear-gradient(135deg, #1a237e, #283593);
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
.flow-step.origem      { background: #2e7d32; }
.flow-step.celula      { background: #1565c0; }
.flow-step.pack        { background: #f9a825; color: #333; }
.flow-step.reciclagem  { background: #00695c; }
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
    background: #e8eaf6;
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
    background: #5c6bc0;
    flex-shrink: 0;
}
.card-tx {
    padding: 0.2rem 1.2rem 0.4rem;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.78rem;
    color: #888;
}
.card-tx a {
    color: #5c6bc0;
    text-decoration: none;
}
.card-tx a:hover {
    text-decoration: underline;
    color: #3949ab;
}
.card-absent {
    padding: 1.2rem;
    color: #888;
    font-style: italic;
}
.emission-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.6rem;
    border-radius: 12px;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    border: 1px solid;
    position: absolute;
    top: 8px;
    right: 12px;
}
.emission-badge svg {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
}
.emission-badge.metadata {
    color: #666;
    border-color: #ccc;
    background: #f5f5f5;
}
.emission-badge.uverify {
    color: #1565c0;
    border-color: #90caf9;
    background: #e3f2fd;
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

/** Generate the self-contained HTML verification report. */
export function generateVerificationReport(
  input: VerificationReportInput,
): string {
  // Build cards
  const cards: string[] = [];
  cards.push(
    buildCard("Origem (l\u00edtio)", input.origem, "#2e7d32", "origem"),
  );
  cards.push(
    buildCard(
      "Fabrica\u00e7\u00e3o das c\u00e9lulas",
      input.celula,
      "#1565c0",
      "celula",
    ),
  );
  cards.push(
    buildCard("Montagem do pack", input.pack, "#f9a825", "pack"),
  );
  if (input.reciclagem !== undefined) {
    cards.push(
      buildCard("Reciclagem", input.reciclagem, "#00695c", "reciclagem"),
    );
  }
  const cardsHtml = cards.join("\n");

  // Build supply chain flow diagram
  const flowSteps: [string, string][] = [
    ["origem", "Origem"],
    ["celula", "C&eacute;lula"],
    ["pack", "Pack"],
  ];
  if (input.reciclagem !== undefined) {
    flowSteps.push(["reciclagem", "Reciclagem"]);
  }

  const flowParts: string[] = [];
  for (let i = 0; i < flowSteps.length; i++) {
    const [cssClass, label] = flowSteps[i]!;
    if (i > 0) {
      flowParts.push(
        `        <span class="flow-arrow">${CHEVRON_SVG}</span>`,
      );
    }
    flowParts.push(
      `        <div class="flow-step ${cssClass}">` +
        `<span class="step-number">${i + 1}</span>${label}</div>`,
    );
  }
  const flowHtml = flowParts.join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Passaporte Digital de Produto &mdash; Bateria EV</title>
<style>
${verificationStylesheet()}
</style>
</head>
<body>
<div class="header">
    ${ICON_BATTERY_HEADER}
    <span class="header-pretitle">Certificado Digital</span>
    <h1>Passaporte Digital de Produto &mdash; Bateria EV</h1>
    <p>Workshop Cardano &mdash; De Jequitinhonha a Europa</p>
</div>
<div class="container">
    <div class="flow">
${flowHtml}
    </div>
${cardsHtml}
    <div class="verified-banner">
        <div class="verified-badge">
            ${VERIFIED_CHECK_SVG}
        </div>
        <div class="verified-pretitle">Certificado Verificado</div>
        <div class="verified-title">Verificado na Blockchain Cardano</div>
        <div class="verified-subtitle">
            Todas as credenciais desta cadeia de suprimentos foram ancoradas
            e verificadas on-chain na rede Cardano preprod.
        </div>
        <div class="verified-chain">Rede: Cardano Preprod &bull; Template: Digital Product Passport</div>
    </div>
    <div class="footer">
        Cadeia de rastreabilidade verificada on-chain.
        <div class="footer-protocol">Template DPP &bull; Rede Cardano Preprod</div>
    </div>
</div>
</body>
</html>`;
}

/** Generate and open the verification report in the browser. */
export async function openVerificationReport(
  input: VerificationReportInput,
): Promise<string> {
  const html = generateVerificationReport(input);
  const path = await openHtmlInBrowser(html, "dpp-verificacao");
  console.log(`  Verification report opened: ${path}`);
  return path;
}
