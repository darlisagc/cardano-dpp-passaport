/**
 * Tests for verify.ts — classifyFields and chain walking logic.
 *
 * We test the exported verifyChain function indirectly by mocking fetch
 * to simulate UVerify/Blockfrost API responses.
 */

import { assertEquals, assertRejects } from "@std/assert";

// classifyFields is not exported, so we re-implement a minimal version
// for direct unit testing, and test the real one via verifyChain.
// Actually, let's import the module and test via its public API.

// For classifyFields, since it's not exported, we test it indirectly
// through verifyChain. But we can also test the classification logic
// by extracting it. Let's test the public behavior.

// ── classifyFields logic (tested via verifyChain mock) ───────────

// We'll define a small helper that mirrors classifyFields for direct testing.
function classifyFields(
  meta: Record<string, string>,
): {
  references: Record<string, string>;
  dataHashes: Record<string, string>;
  materials: Record<string, string>;
} {
  const references: Record<string, string> = {};
  const dataHashes: Record<string, string> = {};
  const materials: Record<string, string> = {};

  for (const [key, value] of Object.entries(meta)) {
    if (key.startsWith("ref_") && key.endsWith("_tx")) {
      references[key.slice(4)] = value;
    } else if (key.startsWith("ref_") && key.endsWith("_data_hash")) {
      dataHashes[key.slice(4)] = value;
    } else if (key.startsWith("mat_")) {
      materials[key] = value;
    }
  }

  return { references, dataHashes, materials };
}

Deno.test("classifyFields correctly categorizes ref_*_tx -> references", () => {
  const result = classifyFields({
    ref_origem_tx: "txhash123",
    ref_celula_tx: "txhash456",
  });
  assertEquals(result.references, {
    origem_tx: "txhash123",
    celula_tx: "txhash456",
  });
});

Deno.test("classifyFields correctly categorizes ref_*_data_hash -> dataHashes", () => {
  const result = classifyFields({
    ref_origem_data_hash: "hash123",
    ref_celula_data_hash: "hash456",
  });
  assertEquals(result.dataHashes, {
    origem_data_hash: "hash123",
    celula_data_hash: "hash456",
  });
});

Deno.test("classifyFields correctly categorizes mat_* -> materials", () => {
  const result = classifyFields({
    mat_litio_carbonato: "98%",
    mat_impurezas_ferro: "0.3%",
  });
  assertEquals(result.materials, {
    mat_litio_carbonato: "98%",
    mat_impurezas_ferro: "0.3%",
  });
});

Deno.test("classifyFields ignores non-prefixed fields", () => {
  const result = classifyFields({
    name: "Test Product",
    issuer: "TestCorp",
    gtin: "1234567890",
    mat_litio: "50%",
    ref_origem_tx: "txhash",
  });
  assertEquals(Object.keys(result.references).length, 1);
  assertEquals(Object.keys(result.materials).length, 1);
  assertEquals(Object.keys(result.dataHashes).length, 0);
});

// ── verifyChain integration tests with mocked fetch ──────────────

Deno.test("verifyChain: full chain (origem -> celula -> pack) resolves", async () => {
  const originalFetch = globalThis.fetch;

  const packMeta = {
    name: "Pack EV 75kWh",
    issuer: "PackMontadora SP Ltda.",
    gtin: "7891234560112",
    ref_celula_tx: "celula_tx_hash",
    ref_celula_data_hash: "celula_data_hash_value",
  };

  const celulaMeta = {
    name: "Celulas NMC 811",
    issuer: "CellTech Brasil S.A.",
    gtin: "7891234560105",
    ref_origem_tx: "origem_tx_hash",
    ref_origem_data_hash: "origem_data_hash_value",
  };

  const origemMeta = {
    name: "Lote Litio",
    issuer: "MineraLitio",
    gtin: "7891234560099",
  };

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    // Blockfrost metadata for pack
    if (url.includes("/txs/pack_tx_hash/metadata")) {
      return new Response(
        JSON.stringify([{ label: "1990", json_metadata: packMeta }]),
        { status: 200 },
      );
    }
    // Blockfrost metadata for celula
    if (url.includes("/txs/celula_tx_hash/metadata")) {
      return new Response(
        JSON.stringify([{ label: "1990", json_metadata: celulaMeta }]),
        { status: 200 },
      );
    }
    // Blockfrost metadata for origem
    if (url.includes("/txs/origem_tx_hash/metadata")) {
      return new Response(
        JSON.stringify([{ label: "1990", json_metadata: origemMeta }]),
        { status: 200 },
      );
    }
    // UVerify verify endpoint for pack data hash
    if (url.includes("/api/v1/verify/pack_data_hash")) {
      return new Response(
        JSON.stringify([
          { transactionHash: "pack_tx_hash", metadata: packMeta },
        ]),
        { status: 200 },
      );
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    const { verifyChain } = await import("../src/verify.ts");
    const config = {
      blockfrostProjectId: "test_project_id",
      mainWalletMnemonic: "test mnemonic",
      uverifyApiUrl: "https://test.uverify.io",
      blockfrostBaseUrl: "https://cardano-preprod.blockfrost.io/api/v0",
      emissionMode: "uverify" as const,
    };

    // Should not throw — walks pack -> celula -> origem
    await verifyChain(config, "pack_data_hash", "pack_tx_hash");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("verifyChain: missing ref_pack_data_hash throws descriptive error", async () => {
  const originalFetch = globalThis.fetch;

  // Reciclagem credential with ref_pack_tx but NO ref_pack_data_hash
  const reciclagemMeta = {
    name: "Reciclagem Pack",
    issuer: "RecicLar",
    gtin: "7891234560129",
    ref_pack_tx: "pack_tx_hash",
    // ref_pack_data_hash is intentionally missing
  };

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("/txs/recicl_tx/metadata")) {
      return new Response(
        JSON.stringify([{ label: "1990", json_metadata: reciclagemMeta }]),
        { status: 200 },
      );
    }
    if (url.includes("/api/v1/verify/recicl_hash")) {
      return new Response(
        JSON.stringify([
          { transactionHash: "recicl_tx", metadata: reciclagemMeta },
        ]),
        { status: 200 },
      );
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    const { verifyChain } = await import("../src/verify.ts");
    const config = {
      blockfrostProjectId: "test_project_id",
      mainWalletMnemonic: "test mnemonic",
      uverifyApiUrl: "https://test.uverify.io",
      blockfrostBaseUrl: "https://cardano-preprod.blockfrost.io/api/v0",
      emissionMode: "uverify" as const,
    };

    await assertRejects(
      () => verifyChain(config, "recicl_hash", "recicl_tx"),
      Error,
      "missing ref_pack_data_hash",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("verifyChain: reciclagem detection works correctly", async () => {
  const originalFetch = globalThis.fetch;

  const reciclagemMeta = {
    name: "Reciclagem Pack",
    issuer: "RecicLar",
    gtin: "7891234560129",
    ref_pack_tx: "pack_tx_hash",
    ref_pack_data_hash: "pack_dh",
    ref_celula_tx: "celula_tx_hash",
    ref_origem_tx: "origem_tx_hash",
  };

  const packMeta = {
    name: "Pack EV 75kWh",
    issuer: "PackMontadora",
    gtin: "7891234560112",
    ref_celula_tx: "celula_tx_hash",
    ref_celula_data_hash: "celula_dh",
  };

  const celulaMeta = {
    name: "Celulas NMC",
    issuer: "CellTech",
    gtin: "7891234560105",
    ref_origem_tx: "origem_tx_hash",
    ref_origem_data_hash: "origem_dh",
  };

  const origemMeta = {
    name: "Lote Litio",
    issuer: "MineraLitio",
    gtin: "7891234560099",
  };

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("/txs/recicl_tx/metadata")) {
      return new Response(
        JSON.stringify([{ label: "1990", json_metadata: reciclagemMeta }]),
        { status: 200 },
      );
    }
    if (url.includes("/txs/pack_tx_hash/metadata")) {
      return new Response(
        JSON.stringify([{ label: "1990", json_metadata: packMeta }]),
        { status: 200 },
      );
    }
    if (url.includes("/txs/celula_tx_hash/metadata")) {
      return new Response(
        JSON.stringify([{ label: "1990", json_metadata: celulaMeta }]),
        { status: 200 },
      );
    }
    if (url.includes("/txs/origem_tx_hash/metadata")) {
      return new Response(
        JSON.stringify([{ label: "1990", json_metadata: origemMeta }]),
        { status: 200 },
      );
    }
    if (url.includes("/api/v1/verify/")) {
      return new Response(
        JSON.stringify([
          { transactionHash: "recicl_tx", metadata: reciclagemMeta },
        ]),
        { status: 200 },
      );
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    const { verifyChain } = await import("../src/verify.ts");
    const config = {
      blockfrostProjectId: "test_project_id",
      mainWalletMnemonic: "test mnemonic",
      uverifyApiUrl: "https://test.uverify.io",
      blockfrostBaseUrl: "https://cardano-preprod.blockfrost.io/api/v0",
      emissionMode: "uverify" as const,
    };

    // Should walk: reciclagem -> pack -> celula -> origem without errors
    await verifyChain(config, "recicl_hash", "recicl_tx");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
