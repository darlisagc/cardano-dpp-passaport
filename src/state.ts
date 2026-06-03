/**
 * Utilitários de persistência de estado no .env.
 *
 * Lê e grava o estado do pipeline (mnemonics, endereços, hashes de tx)
 * no arquivo .env para que cada etapa do CLI possa continuar de onde
 * a etapa anterior parou.
 */

const ENV_PATH = ".env";

/**
 * Lê uma chave específica do arquivo .env.
 * Retorna undefined se a chave não for encontrada ou se o arquivo não existir.
 */
export function readEnvVar(key: string): string | undefined {
  // Primeiro verifica se já está no ambiente (carregado pelo @std/dotenv).
  const fromEnv = Deno.env.get(key)?.trim();
  if (fromEnv) return fromEnv;

  // Fallback: lê o arquivo diretamente (para variáveis escritas após o carregamento inicial).
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
    // Arquivo ainda não existe — tudo bem.
  }
  return undefined;
}

/**
 * Adiciona uma linha de comentário ao arquivo .env.
 */
export function appendCommentToEnv(comment: string): void {
  let content: string;
  try {
    content = Deno.readTextFileSync(ENV_PATH);
  } catch {
    Deno.writeTextFileSync(ENV_PATH, `# ${comment}\n`);
    return;
  }

  // Garante que haja uma quebra de linha antes de adicionar.
  if (!content.endsWith("\n")) {
    content += "\n";
  }
  content += `\n# ${comment}\n`;
  Deno.writeTextFileSync(ENV_PATH, content);
}

/**
 * Adiciona ou atualiza um par chave=valor no arquivo .env.
 *
 * Se a chave já existir, seu valor é substituído no local.
 * Se a chave não existir, uma nova linha é adicionada ao final.
 * Também atualiza o ambiente do processo atual para que chamadas
 * subsequentes a readEnvVar() retornem o novo valor sem reler o arquivo.
 */
export function appendToEnv(key: string, value: string): void {
  // Atualiza o ambiente do processo imediatamente.
  Deno.env.set(key, value);

  let content: string;
  try {
    content = Deno.readTextFileSync(ENV_PATH);
  } catch {
    // Arquivo não existe — cria um novo.
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
    // Garante que haja uma quebra de linha antes de adicionar.
    if (lines.length > 0 && lines[lines.length - 1]?.trim() !== "") {
      lines.push("");
    }
    lines.push(`${key}=${value}`);
  }

  Deno.writeTextFileSync(ENV_PATH, lines.join("\n"));
}
