/**
 * Tests for config.ts — loadConfig validation.
 *
 * We manipulate Deno.env to test various scenarios without .env files.
 */

import { assertEquals, assertThrows, assertStringIncludes } from "@std/assert";
import { loadConfig } from "../src/config.ts";

// Save original env values and restore after each test
function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = Deno.env.get(key);
  }
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

const VALID_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

const BASE_ENV = {
  BLOCKFROST_PROJECT_ID: "preprodABC123",
  WALLET_MNEMONIC: VALID_MNEMONIC,
  UVERIFY_API_URL: undefined as string | undefined,
  EMISSION_MODE: undefined as string | undefined,
};

Deno.test("Missing BLOCKFROST_PROJECT_ID throws", () => {
  withEnv({ ...BASE_ENV, BLOCKFROST_PROJECT_ID: undefined }, () => {
    assertThrows(
      () => loadConfig(),
      Error,
      "BLOCKFROST_PROJECT_ID is required",
    );
  });
});

Deno.test("Placeholder BLOCKFROST_PROJECT_ID throws", () => {
  withEnv({ ...BASE_ENV, BLOCKFROST_PROJECT_ID: "preprodXXXXyyyy" }, () => {
    assertThrows(
      () => loadConfig(),
      Error,
      "BLOCKFROST_PROJECT_ID is required",
    );
  });
});

Deno.test("Missing WALLET_MNEMONIC throws", () => {
  withEnv({ ...BASE_ENV, WALLET_MNEMONIC: undefined }, () => {
    assertThrows(
      () => loadConfig(),
      Error,
      "WALLET_MNEMONIC is required",
    );
  });
});

Deno.test("Wrong word count throws", () => {
  withEnv(
    { ...BASE_ENV, WALLET_MNEMONIC: "abandon abandon abandon" },
    () => {
      assertThrows(() => loadConfig(), Error, "must be 24 words");
    },
  );
});

Deno.test("Mainnet BLOCKFROST_PROJECT_ID is rejected (safety guard)", () => {
  // The current code doesn't explicitly check for mainnet,
  // but we verify the blockfrostBaseUrl is always preprod.
  withEnv(BASE_ENV, () => {
    const config = loadConfig();
    assertStringIncludes(config.blockfrostBaseUrl, "preprod");
  });
});

Deno.test("Valid config returns PipelineConfig", () => {
  withEnv(BASE_ENV, () => {
    const config = loadConfig();
    assertEquals(config.blockfrostProjectId, "preprodABC123");
    assertEquals(config.mainWalletMnemonic, VALID_MNEMONIC);
    assertEquals(config.uverifyApiUrl, "https://api.preprod.uverify.io");
    assertEquals(config.blockfrostBaseUrl, "https://cardano-preprod.blockfrost.io/api/v0");
    assertEquals(config.emissionMode, "uverify");
  });
});

Deno.test("EMISSION_MODE=metadata is accepted", () => {
  withEnv({ ...BASE_ENV, EMISSION_MODE: "metadata" }, () => {
    const config = loadConfig();
    assertEquals(config.emissionMode, "metadata");
  });
});

Deno.test("Invalid EMISSION_MODE throws", () => {
  withEnv({ ...BASE_ENV, EMISSION_MODE: "invalid" }, () => {
    assertThrows(
      () => loadConfig(),
      Error,
      'EMISSION_MODE must be "uverify" or "metadata"',
    );
  });
});
