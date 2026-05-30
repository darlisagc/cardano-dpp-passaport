/**
 * .env state persistence helpers.
 *
 * Reads and writes pipeline state (mnemonics, addresses, tx hashes)
 * to the .env file so that each CLI step can pick up where the
 * previous one left off.
 */

const ENV_PATH = ".env";

/**
 * Read a specific key from the .env file.
 * Returns undefined if the key is not found or the file doesn't exist.
 */
export function readEnvVar(key: string): string | undefined {
  // First check if it's already in the environment (loaded by @std/dotenv).
  const fromEnv = Deno.env.get(key)?.trim();
  if (fromEnv) return fromEnv;

  // Fall back to reading the file directly (for vars written after initial load).
  try {
    const content = Deno.readTextFileSync(ENV_PATH);
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIndex = trimmed.indexOf("=");
      const k = trimmed.slice(0, eqIndex).trim();
      if (k === key) {
        return trimmed.slice(eqIndex + 1).trim();
      }
    }
  } catch {
    // File doesn't exist yet — that's fine.
  }
  return undefined;
}

/**
 * Append or update a key=value pair in the .env file.
 *
 * If the key already exists, its value is replaced in-place.
 * If the key doesn't exist, a new line is appended at the end.
 * Also updates the current process environment so subsequent
 * readEnvVar() calls return the new value without re-reading the file.
 */
export function appendToEnv(key: string, value: string): void {
  // Update the process environment immediately.
  Deno.env.set(key, value);

  let content: string;
  try {
    content = Deno.readTextFileSync(ENV_PATH);
  } catch {
    // File doesn't exist — create it.
    Deno.writeTextFileSync(ENV_PATH, `${key}=${value}\n`);
    return;
  }

  const lines = content.split("\n");
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIndex = trimmed.indexOf("=");
    const k = trimmed.slice(0, eqIndex).trim();
    if (k === key) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    // Ensure there's a newline before appending.
    if (lines.length > 0 && lines[lines.length - 1]?.trim() !== "") {
      lines.push("");
    }
    lines.push(`${key}=${value}`);
  }

  Deno.writeTextFileSync(ENV_PATH, lines.join("\n"));
}
