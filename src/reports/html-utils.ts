/**
 * Shared HTML utilities for receipt/report generation.
 *
 * Provides escape functions, Cexplorer link generation, browser-open helper,
 * actor color/icon configuration, and shared SVG constants.
 */

import type { ActorName } from "../types.ts";

// ── HTML helpers ─────────────────────────────────────────────────────

/** Escape HTML special characters. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Generate a clickable Cexplorer preprod link (truncated hash). */
export function cexplorerLink(txHash: string): string {
  const short = txHash.length > 16 ? txHash.slice(0, 16) + "..." : txHash;
  const url = `https://preprod.cexplorer.io/tx/${escapeHtml(txHash)}`;
  return (
    `<a href="${url}" target="_blank" ` +
    `rel="noopener noreferrer" title="${escapeHtml(txHash)}">` +
    `${escapeHtml(short)}</a>`
  );
}

// ── Browser open ─────────────────────────────────────────────────────

/**
 * Write HTML to a temp file and open it in the default browser.
 * Returns the path to the temp file.
 */
export async function openHtmlInBrowser(
  html: string,
  prefix = "dpp-receipt",
): Promise<string> {
  const tmpDir = Deno.env.get("TMPDIR") || Deno.env.get("TEMP") || "/tmp";
  const timestamp = Date.now();
  const filePath = `${tmpDir}/${prefix}-${timestamp}.html`;
  await Deno.writeTextFile(filePath, html);

  let cmd: string[];
  const os = Deno.build.os;
  if (os === "darwin") {
    cmd = ["open", filePath];
  } else if (os === "windows") {
    cmd = ["cmd", "/c", "start", filePath];
  } else {
    cmd = ["xdg-open", filePath];
  }

  try {
    const program = cmd[0]!;
    const proc = new Deno.Command(program, {
      args: cmd.slice(1),
      stdout: "null",
      stderr: "null",
    });
    const child = proc.spawn();
    // Don't await — let the browser open in the background.
    child.unref();
  } catch {
    console.log(`  (Could not auto-open browser. File saved to: ${filePath})`);
  }

  return filePath;
}

// ── SVG Icons ────────────────────────────────────────────────────────

export const ICON_BATTERY_HEADER =
  '<svg viewBox="0 0 48 48" class="header-icon" fill="none" ' +
  'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<rect x="4" y="14" width="36" height="20" rx="3"/>' +
  '<path d="M44 22v4"/>' +
  '<path d="M12 22v4"/><path d="M20 22v4"/><path d="M28 22v4"/>' +
  "</svg>";

export const ICON_RECYCLE_HEADER =
  '<svg viewBox="0 0 48 48" class="header-icon" fill="none" ' +
  'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M6 24a18 18 0 0 1 18-18 18.75 18.75 0 0 1 13.48 5.48L42 16"/>' +
  '<path d="M42 6v10h-10"/>' +
  '<path d="M42 24a18 18 0 0 1-18 18 18.75 18.75 0 0 1-13.48-5.48L6 32"/>' +
  '<path d="M6 42v-10h10"/>' +
  "</svg>";

const ICON_PICKAXE =
  '<svg viewBox="0 0 24 24" class="card-icon" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M14.5 9.5L12 12"/>' +
  '<path d="M4 20l6-6"/>' +
  '<path d="M10.5 10.5L3 3"/>' +
  '<path d="M21 3l-6.5 6.5"/>' +
  '<path d="M16 3l5 5"/>' +
  "</svg>";

const ICON_FACTORY =
  '<svg viewBox="0 0 24 24" class="card-icon" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M2 20h20"/>' +
  '<path d="M5 20V8l5 4V8l5 4V4h4v16"/>' +
  "</svg>";

const ICON_PACK =
  '<svg viewBox="0 0 24 24" class="card-icon" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<rect x="2" y="7" width="20" height="14" rx="2"/>' +
  '<path d="M12 7V3"/><path d="M2 11h20"/>' +
  '<path d="M7 7V4"/><path d="M17 7V4"/>' +
  "</svg>";

const ICON_RECYCLE =
  '<svg viewBox="0 0 24 24" class="card-icon" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
  '<path d="M21 3v5h-5"/>' +
  '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
  '<path d="M3 21v-5h5"/>' +
  "</svg>";

export const ICON_CHAIN_LINK =
  '<svg viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
  '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
  "</svg>";

export const ICON_SHIELD_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
  '<polyline points="9 12 11 14 15 10"/>' +
  "</svg>";

export const ICON_CHAIN =
  '<svg viewBox="0 0 24 24" class="section-icon" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
  '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
  "</svg>";

export const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
  'stroke="#aaa" stroke-width="2.5" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<polyline points="9 6 15 12 9 18"/>' +
  "</svg>";

export const VERIFIED_CHECK_SVG =
  '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="38" fill="none" ' +
  'stroke="#43a047" stroke-width="2"/><circle cx="40" cy="40" r="32" ' +
  'fill="#43a047"/><polyline points="28 40 36 48 52 32" fill="none" ' +
  'stroke="#fff" stroke-width="3.5" stroke-linecap="round" ' +
  'stroke-linejoin="round"/></svg>';

// ── Actor configuration ──────────────────────────────────────────────

export interface ActorConfig {
  titulo: string;
  subtitulo: string;
  corHeaderFrom: string;
  corHeaderTo: string;
  corCard: string;
  icon: string;
}

export const ACTOR_CONFIG: Record<ActorName, ActorConfig> = {
  origem: {
    titulo: "Origem do Litio",
    subtitulo: "Ator 1 \u2014 MineraLitio Jequitinhonha",
    corHeaderFrom: "#1a237e",
    corHeaderTo: "#283593",
    corCard: "#2e7d32",
    icon: ICON_PICKAXE,
  },
  celula: {
    titulo: "Fabricacao das Celulas",
    subtitulo: "Ator 2 \u2014 CellTech Brasil",
    corHeaderFrom: "#1a237e",
    corHeaderTo: "#283593",
    corCard: "#1565c0",
    icon: ICON_FACTORY,
  },
  pack: {
    titulo: "Montagem do Pack",
    subtitulo: "Ator 3 \u2014 PackMontadora SP",
    corHeaderFrom: "#1a237e",
    corHeaderTo: "#283593",
    corCard: "#f9a825",
    icon: ICON_PACK,
  },
  reciclagem: {
    titulo: "Reciclagem de Bateria",
    subtitulo: "Ator 4 \u2014 RecicLar Sorocaba",
    corHeaderFrom: "#004d40",
    corHeaderTo: "#00695c",
    corCard: "#00695c",
    icon: ICON_RECYCLE,
  },
};

export const CARD_ICONS: Record<ActorName, string> = {
  origem: ICON_PICKAXE,
  celula: ICON_FACTORY,
  pack: ICON_PACK,
  reciclagem: ICON_RECYCLE,
};

// ── Shared CSS template ──────────────────────────────────────────────

/**
 * Generate the shared base stylesheet for receipt/report pages.
 * Accepts header gradient colors and card border color as parameters
 * to avoid duplication across different report types.
 */
export function baseStylesheet(
  headerFrom: string,
  headerTo: string,
  cardColor: string,
): string {
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
    background: linear-gradient(135deg, ${headerFrom}, ${headerTo});
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
    border-left: 6px solid ${cardColor};
}
.card-border {
    border-left: 6px solid;
}
.card-header-strip {
    height: 4px;
    width: 100%;
    background: ${cardColor};
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
.card-body {
    padding: 0 1.2rem 1.2rem;
}
.card-body dl {
    display: grid;
    grid-template-columns: 180px 1fr;
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
.card-absent {
    padding: 1.2rem;
    color: #888;
    font-style: italic;
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
.referencias {
    margin-top: 0.8rem;
}
.referencias h4 {
    font-size: 0.9rem;
    font-weight: 600;
    color: #555;
    margin-bottom: 0.4rem;
}
.ref-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}
.ref-badge {
    display: inline-block;
    background: #e8eaf6;
    border: 1px solid #9fa8da;
    border-left: 3px solid #5c6bc0;
    border-radius: 6px;
    padding: 0.4rem 0.9rem;
    font-size: 0.82rem;
    color: #333;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.ref-badge strong {
    font-weight: 700;
    margin-right: 0.3rem;
}
.ref-badge a {
    color: #3949ab;
    text-decoration: none;
}
.ref-badge a:hover {
    text-decoration: underline;
}
.hashes {
    margin-top: 1rem;
    padding: 0.8rem 1rem;
    background: #fafafa;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.78rem;
    color: #666;
    word-break: break-all;
}
.hashes strong {
    color: #444;
}
.hashes a {
    color: #5c6bc0;
    text-decoration: none;
}
.hashes a:hover {
    text-decoration: underline;
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
}`;
}
