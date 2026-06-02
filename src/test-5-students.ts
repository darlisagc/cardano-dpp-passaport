/**
 * Simulação de 5 alunos simultâneos — Cadeia de credenciais DPP com modos mistos
 *
 * Executa 5 pipelines DPP independentes em paralelo. Cada aluno recebe:
 *   - 4 carteiras de ator (origem, celula, pack, reciclagem)
 *   - 20 ADA por carteira (80 ADA por aluno, 400 ADA total)
 *   - 4 credenciais emitidas sequencialmente, com modos mistos por posição de ator
 *
 * Tabela de modos:
 *   Aluno 1: metadata, metadata, metadata, metadata  (tudo metadata)
 *   Aluno 2: uverify, uverify, uverify, uverify      (tudo uverify)
 *   Aluno 3: metadata, uverify, metadata, uverify    (alternado A)
 *   Aluno 4: uverify, metadata, uverify, metadata    (alternado B)
 *   Aluno 5: metadata, uverify, uverify, metadata    (misto livre)
 *
 * Após a emissão, todos são verificados nos pontos de entrada pack e reciclagem.
 * Financiamento em tx única com 20 saídas.
 * Emissão em paralelo (concorrência = 5).
 *
 * Comentários em Português (BR).
 */

import { loadConfig } from "./config.ts";
import { issueCredential } from "./issuer.ts";
import { issueCredentialDireto } from "./issuer-direto.ts";
import { verifyChain } from "./verify.ts";
import type { PayloadEnv } from "./payloads.ts";
import { fundActorWallets, waitForConfirmation } from "./transfer.ts";
import type { ActorName, ActorWallet, EmissionMode, IssuanceResult, PipelineConfig } from "./types.ts";
import { ACTOR_ORDER } from "./types.ts";
import { createActorWallet, generateMnemonic } from "./wallet.ts";
import { mnemonicSuffix } from "./hash.ts";

// ── Constantes ───────────────────────────────────────────────────────
const NUM_STUDENTS = 5;
const ADA_PER_WALLET = 20;
const ISSUANCE_CONCURRENCY = 5;

// ── Interfaces ───────────────────────────────────────────────────────

/** Resultado de emissão com informação do modo utilizado. */
interface MixedIssuanceResult extends IssuanceResult {
  mode: EmissionMode;
}

/** Configuração inicial de cada aluno (carteiras geradas). */
interface StudentSetup {
  studentId: number;
  wallets: Record<ActorName, ActorWallet>;
  suffix: string;
}

/** Resultado completo de um aluno após emissão. */
interface StudentResult {
  studentId: number;
  wallets: Record<ActorName, ActorWallet>;
  fundingTxHash: string;
  credentials: MixedIssuanceResult[];
  durationMs: number;
}

/** Resultado de verificação de cadeia. */
interface VerificationResult {
  studentId: number;
  entryPoint: "pack" | "reciclagem";
  passed: boolean;
  error?: string;
}

// ── Mapeamento de modos por aluno ────────────────────────────────────

/**
 * Retorna o modo de emissão para cada ator conforme a tabela planejada.
 *
 * | Aluno | Origem   | Celula   | Pack     | Reciclagem |
 * |-------|----------|----------|----------|------------|
 * | 1     | metadata | metadata | metadata | metadata   |
 * | 2     | uverify  | uverify  | uverify  | uverify    |
 * | 3     | metadata | uverify  | metadata | uverify    |
 * | 4     | uverify  | metadata | uverify  | metadata   |
 * | 5     | metadata | uverify  | uverify  | metadata   |
 */
function getModeMap(studentId: number): Record<ActorName, EmissionMode> {
  const modeTable: Record<number, Record<ActorName, EmissionMode>> = {
    1: { origem: "metadata", celula: "metadata", pack: "metadata", reciclagem: "metadata" },
    2: { origem: "uverify", celula: "uverify", pack: "uverify", reciclagem: "uverify" },
    3: { origem: "metadata", celula: "uverify", pack: "metadata", reciclagem: "uverify" },
    4: { origem: "uverify", celula: "metadata", pack: "uverify", reciclagem: "metadata" },
    5: { origem: "metadata", celula: "uverify", pack: "uverify", reciclagem: "metadata" },
  };
  return modeTable[studentId]!;
}

// ── Emissão de credenciais com modos mistos ──────────────────────────

/**
 * Emite as 4 credenciais de um aluno respeitando a cadeia de dependência
 * (origem → celula → pack → reciclagem) e o modo designado para cada ator.
 */
async function issueAllCredentialsMixed(
  config: PipelineConfig,
  wallets: Record<ActorName, ActorWallet>,
  env: PayloadEnv,
  studentId: number,
): Promise<MixedIssuanceResult[]> {
  const modeMap = getModeMap(studentId);
  const results: MixedIssuanceResult[] = [];

  console.log(`\n--- [Aluno ${studentId}] Emitindo credenciais (modo misto) ---`);
  console.log(
    `  Modos: origem=${modeMap.origem}, celula=${modeMap.celula}, ` +
      `pack=${modeMap.pack}, reciclagem=${modeMap.reciclagem}`,
  );

  // Ator 1: Origem (sem referências)
  const r1 = modeMap.origem === "metadata"
    ? await issueCredentialDireto(config, wallets.origem, env)
    : await issueCredential(config, wallets.origem, env);
  env.ator1Tx = r1.txHash;
  results.push({ ...r1, mode: modeMap.origem });

  // Ator 2: Celula (referencia Ator 1)
  const r2 = modeMap.celula === "metadata"
    ? await issueCredentialDireto(config, wallets.celula, env)
    : await issueCredential(config, wallets.celula, env);
  env.ator2Tx = r2.txHash;
  results.push({ ...r2, mode: modeMap.celula });

  // Ator 3: Pack (referencia Ator 2)
  const r3 = modeMap.pack === "metadata"
    ? await issueCredentialDireto(config, wallets.pack, env)
    : await issueCredential(config, wallets.pack, env);
  env.ator3Tx = r3.txHash;
  results.push({ ...r3, mode: modeMap.pack });

  // Ator 4: Reciclagem (referencia Atores 1, 2, 3)
  const r4 = modeMap.reciclagem === "metadata"
    ? await issueCredentialDireto(config, wallets.reciclagem, env)
    : await issueCredential(config, wallets.reciclagem, env);
  results.push({ ...r4, mode: modeMap.reciclagem });

  return results;
}

// ── Pipeline de emissão de um aluno ──────────────────────────────────

/**
 * Executa a emissão completa para um aluno (assume carteiras já financiadas).
 */
async function issueStudentCredentials(
  student: StudentSetup,
  config: PipelineConfig,
): Promise<MixedIssuanceResult[]> {
  const env: PayloadEnv = { suffix: student.suffix };

  console.log(
    `  [Aluno ${student.studentId}] Iniciando emissão de 4 credenciais (suffix: ${student.suffix})...`,
  );
  const credentials = await issueAllCredentialsMixed(
    config,
    student.wallets,
    env,
    student.studentId,
  );
  console.log(`  [Aluno ${student.studentId}] CONCLUÍDO — 4 credenciais emitidas.`);

  return credentials;
}

// ── Execução paralela com limite de concorrência ─────────────────────

/**
 * Executa tarefas em paralelo com limite de concorrência.
 */
async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── FASE 4: Verificação ──────────────────────────────────────────────

/**
 * Verifica todos os alunos nos pontos de entrada pack e reciclagem.
 */
async function verifyAllStudents(
  config: PipelineConfig,
  results: StudentResult[],
): Promise<VerificationResult[]> {
  const verificationResults: VerificationResult[] = [];

  for (const student of results) {
    const packCred = student.credentials.find((c) => c.actor === "pack");
    const reciclagemCred = student.credentials.find((c) => c.actor === "reciclagem");

    // Verificação a partir do pack
    if (packCred) {
      console.log(`\n${"#".repeat(64)}`);
      console.log(`### Aluno ${student.studentId} — Verificação Pack ###`);
      console.log(`${"#".repeat(64)}`);
      try {
        await verifyChain(config, packCred.dataHash, packCred.txHash);
        verificationResults.push({
          studentId: student.studentId,
          entryPoint: "pack",
          passed: true,
        });
        console.log(`\n>>> Aluno ${student.studentId} (pack): APROVADO <<<`);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        verificationResults.push({
          studentId: student.studentId,
          entryPoint: "pack",
          passed: false,
          error,
        });
        console.error(`\n>>> Aluno ${student.studentId} (pack): FALHOU — ${error} <<<`);
      }
    }

    // Verificação a partir da reciclagem
    if (reciclagemCred) {
      console.log(`\n${"#".repeat(64)}`);
      console.log(`### Aluno ${student.studentId} — Verificação Reciclagem ###`);
      console.log(`${"#".repeat(64)}`);
      try {
        await verifyChain(config, reciclagemCred.dataHash, reciclagemCred.txHash);
        verificationResults.push({
          studentId: student.studentId,
          entryPoint: "reciclagem",
          passed: true,
        });
        console.log(`\n>>> Aluno ${student.studentId} (reciclagem): APROVADO <<<`);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        verificationResults.push({
          studentId: student.studentId,
          entryPoint: "reciclagem",
          passed: false,
          error,
        });
        console.error(
          `\n>>> Aluno ${student.studentId} (reciclagem): FALHOU — ${error} <<<`,
        );
      }
    }
  }

  return verificationResults;
}

// ── Resumo final ─────────────────────────────────────────────────────

/**
 * Imprime o resumo completo da simulação com tabela de credenciais e verificação.
 */
function printSimulationSummary(
  results: StudentResult[],
  verificationResults?: VerificationResult[],
): void {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`SIMULAÇÃO CONCLUÍDA — ${results.length} Alunos (modos mistos: UVerify + metadata)`);
  console.log("=".repeat(80));

  for (const r of results) {
    console.log(`\n--- Aluno ${r.studentId} (${(r.durationMs / 1000).toFixed(0)}s) ---`);
    console.log(`  Tx de financiamento: ${r.fundingTxHash}`);

    console.log("  Credenciais:");
    for (const c of r.credentials) {
      console.log(`    ${c.actor} [${c.mode}]:`);
      console.log(`      tx_hash:   ${c.txHash}`);
      console.log(`      data_hash: ${c.dataHash}`);
      console.log(`      Cexplorer: https://preprod.cexplorer.io/tx/${c.txHash}`);
    }
  }

  // Tabela resumo compacta
  console.log(`\n${"=".repeat(80)}`);
  console.log("Tabela resumo:");
  console.log(
    `${"Aluno".padEnd(10)} ${"Ator".padEnd(12)} ${"Modo".padEnd(10)} ` +
      `${"TX Hash".padEnd(66)} Data Hash`,
  );
  console.log("-".repeat(170));
  for (const r of results) {
    for (const c of r.credentials) {
      console.log(
        `${String(r.studentId).padEnd(10)} ${c.actor.padEnd(12)} ${c.mode.padEnd(10)} ` +
          `${c.txHash.padEnd(66)} ${c.dataHash}`,
      );
    }
  }
  console.log("=".repeat(80));

  // Resumo de verificação
  if (verificationResults && verificationResults.length > 0) {
    const passedCount = verificationResults.filter((v) => v.passed).length;
    const failedCount = verificationResults.filter((v) => !v.passed).length;

    console.log(`\n${"=".repeat(80)}`);
    console.log("RESUMO DE VERIFICAÇÃO");
    console.log("=".repeat(80));
    console.log(
      `${"Aluno".padEnd(10)} ${"Ponto Entrada".padEnd(14)} ${"Resultado".padEnd(10)} Erro`,
    );
    console.log("-".repeat(80));
    for (const v of verificationResults) {
      const status = v.passed ? "APROVADO" : "FALHOU";
      console.log(
        `${String(v.studentId).padEnd(10)} ${v.entryPoint.padEnd(14)} ${status.padEnd(10)} ${v.error ?? ""}`,
      );
    }
    console.log("-".repeat(80));
    console.log(`Total: ${passedCount} aprovados, ${failedCount} falharam de ${verificationResults.length}`);
    console.log("=".repeat(80));
  }
}

// ── Ponto de entrada principal ───────────────────────────────────────

/**
 * Função principal: simula 5 alunos com emissão de modos mistos + verificação dual.
 */
async function main(): Promise<void> {
  const totalAda = NUM_STUDENTS * 4 * ADA_PER_WALLET;
  console.log("=".repeat(80));
  console.log(`Cardano DPP — Simulação de ${NUM_STUDENTS} Alunos com Modos Mistos`);
  console.log(`${NUM_STUDENTS} alunos x 4 atores x ${ADA_PER_WALLET} ADA = ${totalAda} ADA total`);
  console.log("=".repeat(80));

  // Carregar configuração do ambiente.
  let config: PipelineConfig;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(`Erro de configuração: ${e instanceof Error ? e.message : e}`);
    Deno.exit(1);
  }

  console.log(`Blockfrost: ${config.blockfrostProjectId.slice(0, 12)}...`);
  console.log(`Modo:       misto (UVerify + metadata nativo)`);
  console.log(`Concorrência: ${ISSUANCE_CONCURRENCY} alunos em paralelo`);
  console.log(`Mnemonic:   ${config.mainWalletMnemonic.split(" ").slice(0, 3).join(" ")}...`);

  const blockfrostConfig = {
    baseUrl: config.blockfrostBaseUrl,
    projectId: config.blockfrostProjectId,
  };

  // ── FASE 1: Gerar 20 carteiras (5 alunos x 4 atores) ──────────────
  console.log(`\n${"=".repeat(80)}`);
  console.log("FASE 1: Gerar carteiras");
  console.log("=".repeat(80));

  const students: StudentSetup[] = [];
  for (let i = 1; i <= NUM_STUDENTS; i++) {
    const wallets = {} as Record<ActorName, ActorWallet>;
    for (const name of ACTOR_ORDER) {
      const mnemonic = generateMnemonic();
      const wallet = await createActorWallet(name, mnemonic, blockfrostConfig);
      wallets[name] = wallet;
    }
    const suffix = await mnemonicSuffix(wallets.origem.mnemonic);
    students.push({ studentId: i, wallets, suffix });
    console.log(`  Aluno ${i}: carteiras geradas (suffix: ${suffix})`);
  }

  // ── FASE 2: Financiar todas as carteiras ───────────────────────────
  console.log(`\n${"=".repeat(80)}`);
  console.log("FASE 2: Financiar carteiras");
  console.log("=".repeat(80));

  // Todas as 20 carteiras em uma única tx de financiamento.
  const allWallets: ActorWallet[] = [];
  for (const student of students) {
    for (const name of ACTOR_ORDER) {
      allWallets.push(student.wallets[name]);
    }
  }

  const totalFunding = allWallets.length * ADA_PER_WALLET;
  console.log(`  ${allWallets.length} carteiras x ${ADA_PER_WALLET} ADA = ${totalFunding} ADA`);

  // Tentar financiamento com até 3 tentativas.
  let fundingTxHash = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fundingTxHash = await fundActorWallets(config, allWallets, ADA_PER_WALLET);
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < 3) {
        console.log(`  Tentativa ${attempt}/3 falhou (${msg.slice(0, 80)}), aguardando 30s...`);
        await new Promise((r) => setTimeout(r, 30_000));
      } else {
        throw new Error(`Financiamento falhou após 3 tentativas: ${msg}`);
      }
    }
  }

  console.log(`  Tx de financiamento: ${fundingTxHash}`);
  console.log(`  Aguardando confirmação on-chain...`);
  await waitForConfirmation(config, fundingTxHash);
  console.log(`  Confirmado! Aguardando 15s para propagação de UTxO...`);
  await new Promise((r) => setTimeout(r, 15_000));

  // ── FASE 3: Emitir credenciais em paralelo (5 alunos) ──────────────
  console.log(`\n${"=".repeat(80)}`);
  console.log(`FASE 3: Emitir credenciais — modos mistos (${ISSUANCE_CONCURRENCY} alunos em paralelo)`);
  console.log("=".repeat(80));

  const startTime = Date.now();

  const rawResults = await parallelMap(
    students,
    ISSUANCE_CONCURRENCY,
    async (student): Promise<StudentResult | null> => {
      const t0 = Date.now();
      try {
        const credentials = await issueStudentCredentials(student, config);
        return {
          studentId: student.studentId,
          wallets: student.wallets,
          fundingTxHash,
          credentials,
          durationMs: Date.now() - t0,
        };
      } catch (e) {
        console.error(
          `\n  ALUNO ${student.studentId} FALHOU: ${e instanceof Error ? e.message : e}`,
        );
        return null;
      }
    },
  );

  const totalDuration = Date.now() - startTime;
  const results = rawResults.filter((r): r is StudentResult => r !== null);

  console.log(`\n${results.length}/${NUM_STUDENTS} alunos completaram a emissão.`);
  if (results.length < NUM_STUDENTS) {
    console.log(`${NUM_STUDENTS - results.length} alunos falharam na emissão.`);
  }
  console.log(`Duração total da fase de emissão: ${(totalDuration / 1000).toFixed(0)}s`);
  console.log(
    `Credenciais emitidas: ${results.length * 4} (${results.length} alunos x 4 atores)`,
  );

  // ── FASE 4: Verificar todos os alunos em pack + reciclagem ─────────
  let verificationResults: VerificationResult[] = [];
  if (results.length > 0) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(
      `FASE 4: Verificar ${results.length} alunos nos pontos de entrada pack + reciclagem`,
    );
    console.log("=".repeat(80));

    verificationResults = await verifyAllStudents(config, results);
  }

  // ── FASE 5: Resumo Final ───────────────────────────────────────────
  if (results.length > 0) {
    printSimulationSummary(results, verificationResults);
  }
}

// Executar a simulação.
main().catch((err) => {
  console.error("\nERRO FATAL:", err);
  Deno.exit(1);
});
