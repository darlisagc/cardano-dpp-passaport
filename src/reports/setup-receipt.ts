/**
 * Recibo HTML de setup — gerado após criação das carteiras e financiamento.
 *
 * Este é um tipo NOVO de recibo (sem equivalente em Python). Mostra as carteiras
 * criadas com endereços e mnemonics mascarados, além dos detalhes da
 * transação de financiamento.
 */

import type { ActorName, ActorWallet } from "../types.ts";
import { ACTOR_ORDER } from "../types.ts";
import {
  escapeHtml,
  ICON_BATTERY_HEADER,
  openHtmlInBrowser,
  VERIFIED_CHECK_SVG,
} from "./html-utils.ts";

export interface SetupReceiptInput {
  wallets: Record<ActorName, ActorWallet>;
  fundingTxHash: string;
  adaPerWallet: number;
}

/** Mascara um mnemonic: mostra as 3 primeiras palavras, substitui o resto com reticências. */
function maskMnemonic(mnemonic: string): string {
  const words = mnemonic.split(" ");
  if (words.length <= 3) return mnemonic;
  return words.slice(0, 3).join(" ") + " ...";
}

/** Informações de exibição dos atores para a tabela. */
const ACTOR_DISPLAY: Record<
  ActorName,
  { num: string; label: string; company: string; color: string }
> = {
  origem: {
    num: "1",
    label: "Origem",
    company: "MineraLitio Jequitinhonha",
    color: "#2e7d32",
  },
  celula: {
    num: "2",
    label: "C\u00e9lula",
    company: "CellTech Brasil",
    color: "#1565c0",
  },
  pack: {
    num: "3",
    label: "Pack",
    company: "PackMontadora SP",
    color: "#f9a825",
  },
  reciclagem: {
    num: "4",
    label: "Reciclagem",
    company: "RecicLar Sorocaba",
    color: "#00695c",
  },
};

/** Gera o recibo HTML autocontido de setup. */
export function generateSetupReceipt(input: SetupReceiptInput): string {
  const esc = escapeHtml;
  const totalAda = input.adaPerWallet * ACTOR_ORDER.length;
  const cexplorerUrl = `https://preprod.cexplorer.io/tx/${esc(input.fundingTxHash)}`;
  const shortTx =
    input.fundingTxHash.length > 20
      ? input.fundingTxHash.slice(0, 20) + "..."
      : input.fundingTxHash;

  // Constrói as linhas da tabela de carteiras
  const walletRows = ACTOR_ORDER.map((name) => {
    const w = input.wallets[name];
    const info = ACTOR_DISPLAY[name];
    const maskedMnemonic = maskMnemonic(w.mnemonic);
    return (
      `                <tr>\n` +
      `                    <td><span class="actor-badge" style="background:${info.color};${name === "pack" ? "color:#333" : ""}">${esc(info.label)}</span></td>\n` +
      `                    <td class="company">${esc(info.company)}</td>\n` +
      `                    <td class="address">${esc(w.address)}</td>\n` +
      `                    <td class="mnemonic">${esc(maskedMnemonic)}</td>\n` +
      `                </tr>`
    );
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Setup Completo &mdash; Carteiras e Financiamento</title>
<style>
* {
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
.card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    margin-bottom: 1.5rem;
    overflow: hidden;
    border-left: 6px solid #1565c0;
}
.card-header-strip {
    height: 4px;
    width: 100%;
    background: #1565c0;
}
.card-header {
    padding: 1rem 1.2rem 0.6rem;
    font-size: 1.15rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.5rem;
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
.card.funding {
    border-left-color: #2e7d32;
}
.card.funding .card-header-strip {
    background: #2e7d32;
}
table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
}
th {
    text-align: left;
    font-weight: 600;
    color: #555;
    padding: 0.5rem 0.6rem;
    border-bottom: 2px solid #e0e0e0;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
td {
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid #f0f0f0;
    vertical-align: middle;
}
tr:nth-child(even) td {
    background: rgba(0,0,0,0.02);
}
.actor-badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    border-radius: 12px;
    font-size: 0.78rem;
    font-weight: 600;
    color: #fff;
    letter-spacing: 0.02em;
}
.address {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.72rem;
    word-break: break-all;
    color: #555;
}
.mnemonic {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.78rem;
    color: #888;
    font-style: italic;
}
.company {
    font-weight: 500;
    color: #444;
}
.funding-details {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 0;
}
.funding-details dt,
.funding-details dd {
    padding: 0.4rem 0.5rem;
    font-size: 0.9rem;
    margin: 0;
}
.funding-details dt {
    font-weight: 600;
    color: #555;
}
.funding-details dt:nth-of-type(even),
.funding-details dd:nth-of-type(even) {
    background: rgba(0,0,0,0.025);
}
.funding-details a {
    color: #5c6bc0;
    text-decoration: none;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.85rem;
}
.funding-details a:hover {
    text-decoration: underline;
    color: #3949ab;
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
    table { font-size: 0.8rem; }
    .address { font-size: 0.65rem; }
    .funding-details {
        grid-template-columns: 1fr;
    }
    .funding-details dt {
        margin-top: 0.3rem;
    }
}
</style>
</head>
<body>
<div class="header">
    ${ICON_BATTERY_HEADER}
    <span class="header-pretitle">Cardano DPP Passaport</span>
    <h1>Setup Completo &mdash; Carteiras e Financiamento</h1>
    <p>Workshop Cardano &mdash; De Jequitinhonha a Europa</p>
</div>
<div class="container">
    <div class="card">
        <div class="card-header-strip"></div>
        <div class="card-header">
            <svg viewBox="0 0 24 24" class="card-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            Carteiras dos Atores
        </div>
        <div class="card-body">
            <table>
                <thead>
                    <tr>
                        <th>Ator</th>
                        <th>Empresa</th>
                        <th>Endereco</th>
                        <th>Mnemonic</th>
                    </tr>
                </thead>
                <tbody>
${walletRows}
                </tbody>
            </table>
        </div>
    </div>
    <div class="card funding">
        <div class="card-header-strip"></div>
        <div class="card-header">
            <svg viewBox="0 0 24 24" class="card-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Transacao de Financiamento
        </div>
        <div class="card-body">
            <dl class="funding-details">
                <dt>ADA por carteira</dt>
                <dd>${input.adaPerWallet} ADA</dd>
                <dt>Total financiado</dt>
                <dd>${totalAda} ADA (${ACTOR_ORDER.length} carteiras)</dd>
                <dt>Tx Hash</dt>
                <dd><a href="${cexplorerUrl}" target="_blank" rel="noopener noreferrer" title="${esc(input.fundingTxHash)}">${esc(shortTx)}</a></dd>
                <dt>Cexplorer</dt>
                <dd><a href="${cexplorerUrl}" target="_blank" rel="noopener noreferrer">Ver no Cexplorer</a></dd>
            </dl>
        </div>
    </div>
    <div class="verified-banner">
        <div class="verified-badge">
            ${VERIFIED_CHECK_SVG}
        </div>
        <div class="verified-pretitle">Setup Concluido</div>
        <div class="verified-title">Carteiras criadas e financiadas on-chain</div>
        <div class="verified-subtitle">
            Todas as carteiras dos atores foram geradas e financiadas
            com sucesso na rede Cardano preprod.
        </div>
        <div class="verified-chain">Rede: Cardano Preprod &bull; ${totalAda} ADA distribuidos</div>
    </div>
    <div class="footer">
        Setup concluido com sucesso.
        <div class="footer-protocol">Proximo passo: deno task issue-origem</div>
    </div>
</div>
</body>
</html>`;
}

/** Gera e abre o recibo de setup no navegador. */
export async function openSetupReceipt(
  input: SetupReceiptInput,
): Promise<string> {
  const html = generateSetupReceipt(input);
  const path = await openHtmlInBrowser(html, "dpp-setup");
  console.log(`  Setup receipt opened: ${path}`);
  return path;
}
