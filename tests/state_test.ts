/**
 * Tests for state.ts — readEnvVar and appendToEnv.
 *
 * Uses a temp directory to avoid polluting the real .env file.
 * We patch the ENV_PATH by importing and testing the functions
 * with temp files.
 */

import { assertEquals } from "@std/assert";

// Since state.ts uses a hardcoded ENV_PATH = ".env", we test by
// changing the working directory to a temp dir for isolation.

async function withTempDir(
  fn: (dir: string) => void | Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "state_test_" });
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    // Clear any cached env vars that might interfere
    const keysToClean = ["TEST_KEY_A", "TEST_KEY_B", "TEST_KEY_C", "EXISTING_KEY", "NEW_KEY"];
    for (const key of keysToClean) {
      Deno.env.delete(key);
    }
    await fn(tempDir);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
}

// We need to re-import state.ts functions fresh since they use hardcoded ".env"
// relative path. Importing them once is fine since they use Deno.readTextFileSync
// which reads relative to CWD.

Deno.test("appendToEnv creates file if missing", async () => {
  await withTempDir(async () => {
    const { appendToEnv } = await import("../src/state.ts");
    appendToEnv("TEST_KEY_A", "value_a");
    const content = await Deno.readTextFile(".env");
    assertEquals(content.includes("TEST_KEY_A=value_a"), true);
  });
});

Deno.test("appendToEnv updates existing key in-place", async () => {
  await withTempDir(async () => {
    await Deno.writeTextFile(".env", "EXISTING_KEY=old_value\nOTHER=keep\n");
    // Clear env so appendToEnv reads from file
    Deno.env.delete("EXISTING_KEY");
    Deno.env.delete("OTHER");

    const { appendToEnv } = await import("../src/state.ts");
    appendToEnv("EXISTING_KEY", "new_value");
    const content = await Deno.readTextFile(".env");
    assertEquals(content.includes("EXISTING_KEY=new_value"), true);
    assertEquals(content.includes("old_value"), false);
    assertEquals(content.includes("OTHER=keep"), true);
  });
});

Deno.test("appendToEnv appends new key", async () => {
  await withTempDir(async () => {
    await Deno.writeTextFile(".env", "EXISTING_KEY=value1\n");
    Deno.env.delete("EXISTING_KEY");
    Deno.env.delete("NEW_KEY");

    const { appendToEnv } = await import("../src/state.ts");
    appendToEnv("NEW_KEY", "value2");
    const content = await Deno.readTextFile(".env");
    assertEquals(content.includes("EXISTING_KEY=value1"), true);
    assertEquals(content.includes("NEW_KEY=value2"), true);
  });
});

Deno.test("readEnvVar reads existing key", async () => {
  await withTempDir(async () => {
    await Deno.writeTextFile(".env", "TEST_KEY_B=hello_world\n");
    // Set it in env so readEnvVar finds it
    Deno.env.set("TEST_KEY_B", "hello_world");

    const { readEnvVar } = await import("../src/state.ts");
    const value = readEnvVar("TEST_KEY_B");
    assertEquals(value, "hello_world");
    Deno.env.delete("TEST_KEY_B");
  });
});

Deno.test("readEnvVar returns undefined for missing key", async () => {
  await withTempDir(async () => {
    await Deno.writeTextFile(".env", "OTHER_KEY=value\n");
    Deno.env.delete("NONEXISTENT_KEY");

    const { readEnvVar } = await import("../src/state.ts");
    const value = readEnvVar("NONEXISTENT_KEY");
    assertEquals(value, undefined);
  });
});

Deno.test("readEnvVar returns undefined if file doesn't exist", async () => {
  await withTempDir(async () => {
    Deno.env.delete("TEST_KEY_C");

    const { readEnvVar } = await import("../src/state.ts");
    const value = readEnvVar("TEST_KEY_C");
    assertEquals(value, undefined);
  });
});
