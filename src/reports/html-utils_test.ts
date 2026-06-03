/**
 * Tests for reports/html-utils.ts — shared HTML utility functions.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  ACTOR_CONFIG,
  baseStylesheet,
  CARD_ICONS,
  cexplorerLink,
  escapeHtml,
  ICON_BATTERY_HEADER,
  VERIFIED_CHECK_SVG,
} from "./html-utils.ts";

// ── escapeHtml ───────────────────────────────────────────────────────

Deno.test("escapeHtml escapes ampersand", () => {
  assertEquals(escapeHtml("a & b"), "a &amp; b");
});

Deno.test("escapeHtml escapes angle brackets", () => {
  assertEquals(escapeHtml("<script>"), "&lt;script&gt;");
});

Deno.test("escapeHtml escapes double quotes", () => {
  assertEquals(escapeHtml('attr="val"'), "attr=&quot;val&quot;");
});

Deno.test("escapeHtml handles multiple special chars together", () => {
  assertEquals(
    escapeHtml('<a href="x&y">'),
    "&lt;a href=&quot;x&amp;y&quot;&gt;",
  );
});

Deno.test("escapeHtml preserves plain text", () => {
  assertEquals(escapeHtml("hello world 123"), "hello world 123");
});

// ── cexplorerLink ────────────────────────────────────────────────────

Deno.test("cexplorerLink truncates long tx hashes", () => {
  const hash =
    "5b1b062887313c4a263661d197f818240f9245f53749adac9fd4f36cd835cb80";
  const link = cexplorerLink(hash);
  assertStringIncludes(link, "5b1b062887313c4a...");
  assertStringIncludes(link, `https://preprod.cexplorer.io/tx/${hash}`);
  assertStringIncludes(link, 'target="_blank"');
  assertStringIncludes(link, 'rel="noopener noreferrer"');
});

Deno.test("cexplorerLink does not truncate short hashes", () => {
  const hash = "abc123";
  const link = cexplorerLink(hash);
  assertStringIncludes(link, "abc123");
  // Should not contain "..."
  assertEquals(link.includes("..."), false);
});

Deno.test("cexplorerLink escapes special chars in hash", () => {
  const hash = 'hash"with<special>';
  const link = cexplorerLink(hash);
  assertStringIncludes(link, "&quot;");
  assertStringIncludes(link, "&lt;");
});

// ── ACTOR_CONFIG ─────────────────────────────────────────────────────

Deno.test("ACTOR_CONFIG has entries for all 4 actors", () => {
  const keys = Object.keys(ACTOR_CONFIG);
  assertEquals(keys.length, 4);
  assertEquals(keys.includes("origem"), true);
  assertEquals(keys.includes("celula"), true);
  assertEquals(keys.includes("pack"), true);
  assertEquals(keys.includes("reciclagem"), true);
});

Deno.test("ACTOR_CONFIG entries have all required fields", () => {
  for (const [_name, cfg] of Object.entries(ACTOR_CONFIG)) {
    assertEquals(typeof cfg.titulo, "string");
    assertEquals(typeof cfg.subtitulo, "string");
    assertEquals(typeof cfg.corHeaderFrom, "string");
    assertEquals(typeof cfg.corHeaderTo, "string");
    assertEquals(typeof cfg.corCard, "string");
    assertEquals(typeof cfg.icon, "string");
    // Colors should be hex
    assertEquals(cfg.corCard.startsWith("#"), true);
  }
});

Deno.test("ACTOR_CONFIG reciclagem has teal color scheme", () => {
  const rec = ACTOR_CONFIG.reciclagem;
  assertEquals(rec.corHeaderFrom, "#004d40");
  assertEquals(rec.corHeaderTo, "#00695c");
  assertEquals(rec.corCard, "#00695c");
});

// ── CARD_ICONS ───────────────────────────────────────────────────────

Deno.test("CARD_ICONS has entries for all 4 actors", () => {
  assertEquals(Object.keys(CARD_ICONS).length, 4);
  for (const icon of Object.values(CARD_ICONS)) {
    assertStringIncludes(icon, "<svg");
  }
});

// ── SVG constants ────────────────────────────────────────────────────

Deno.test("ICON_BATTERY_HEADER is valid SVG", () => {
  assertStringIncludes(ICON_BATTERY_HEADER, "<svg");
  assertStringIncludes(ICON_BATTERY_HEADER, "</svg>");
});

Deno.test("VERIFIED_CHECK_SVG is valid SVG", () => {
  assertStringIncludes(VERIFIED_CHECK_SVG, "<svg");
  assertStringIncludes(VERIFIED_CHECK_SVG, "</svg>");
});

// ── baseStylesheet ───────────────────────────────────────────────────

Deno.test("baseStylesheet injects header gradient colors", () => {
  const css = baseStylesheet("#1a237e", "#283593", "#2e7d32");
  assertStringIncludes(css, "#1a237e");
  assertStringIncludes(css, "#283593");
});

Deno.test("baseStylesheet injects card border color", () => {
  const css = baseStylesheet("#1a237e", "#283593", "#f9a825");
  assertStringIncludes(css, "#f9a825");
});

Deno.test("baseStylesheet contains responsive media query", () => {
  const css = baseStylesheet("#000", "#111", "#222");
  assertStringIncludes(css, "@media (max-width: 600px)");
});

Deno.test("baseStylesheet contains essential CSS classes", () => {
  const css = baseStylesheet("#000", "#111", "#222");
  assertStringIncludes(css, ".header");
  assertStringIncludes(css, ".container");
  assertStringIncludes(css, ".card");
  assertStringIncludes(css, ".verified-banner");
  assertStringIncludes(css, ".mat-tag");
});
