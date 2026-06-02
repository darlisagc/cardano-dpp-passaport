/**
 * Verify DPP chain for all 10 students from the simulation.
 *
 * Uses each student's pack data_hash as the entry point and walks
 * the chain backward: pack → celula → origem.
 */

import { loadConfig } from "./config.ts";
import { verifyChain } from "./verify.ts";

const STUDENT_PACKS: { student: number; txHash: string; dataHash: string }[] = [
  { student: 1,  txHash: "e966d6ee63d20cfc0dcab9af6ac1fe2a7cca0351c340f96b4f3985922e207e10", dataHash: "dfa41da504ecf3ab3bccfcba79ba1c92c40352719eaee083b089e14481c1db3d" },
  { student: 2,  txHash: "40ff4e38685ba78eb26b28c228de2582080404bb48bd90435023881cf851a478", dataHash: "002c04e049a8a8b79e3eb8f4ef95cbeb73238406fd64e72e6cf39e6ff4ec37f4" },
  { student: 3,  txHash: "020522acbb180a40c430dc72ea30e2d77bf3ac5939f2d1b1532e42eedf412eef", dataHash: "13fe13c42e3bc7d9cee580830aa3955050ed8c5a983f85d8c59e2ee2dadf8e09" },
  { student: 4,  txHash: "557b0a9c7083df1f5ab8b06a06cbaa0dfc1cca54619a2b4a99ae9b947de1609f", dataHash: "872688c15523ecd68bf9bca3618de73c128f5ef70f7365dcfe73149839509e53" },
  { student: 5,  txHash: "3e80cfc7681abc05564d74218225ba748aaa96e5fddccd36ece7f115e1a417a4", dataHash: "8c4802b292bd1fae0ae96569d021e92df3f0a3b758662beabc88e0be34828b60" },
  { student: 6,  txHash: "091a5c86a265cfec6b6b1cc1a81556a2c648428b6b02845d0f59d8eae13e852a", dataHash: "4a5c9ce061457ea4a0fcea7a40b276a9d0f39a2e911f8e8e85cfda8c86a09448" },
  { student: 7,  txHash: "e20217917c706d7fc5d8c1a6adcbb444ee5cfd085bcc3ee89d83366c4c56fcd5", dataHash: "c82c47d87c6a23956e9c9bf32c584cfbce11c08acc0d37073053e5eb373fd1bd" },
  { student: 8,  txHash: "6fb01c7c5d0608259c49e57f789738266173bd712eefd74883705f351c6703d6", dataHash: "002a44a6e9b9a117bab22f44f2753a3bd06982728bca5d73cd628618046bc560" },
  { student: 9,  txHash: "e776a59d64574791613f412a0aaabe1c225e63dd5c63a28ce36a9086d6609357", dataHash: "41b226d61704c7ed9a62a1591f454b418a1cf9ef008fb015b4d6ddc6c5f16cb5" },
  { student: 10, txHash: "ef2bb4d4427cf01e2335190ec4580ef3600d203158b53fdf964b0e41ae85d5db", dataHash: "cc3eb1997ff0b63bcf29f9dba22c4140806800dfe892aa550dd6af7a23bf6994" },
];

async function main(): Promise<void> {
  const config = loadConfig();
  let passed = 0;
  let failed = 0;

  for (const { student, txHash, dataHash } of STUDENT_PACKS) {
    console.log(`\n\n${"#".repeat(64)}`);
    console.log(`### STUDENT ${student} — Pack Verification ###`);
    console.log(`${"#".repeat(64)}`);

    try {
      await verifyChain(config, dataHash, txHash);
      passed++;
      console.log(`\n>>> Student ${student}: PASSED <<<`);
    } catch (e) {
      failed++;
      console.error(`\n>>> Student ${student}: FAILED — ${e instanceof Error ? e.message : e} <<<`);
    }
  }

  console.log(`\n\n${"=".repeat(64)}`);
  console.log(`VERIFICATION SUMMARY: ${passed} passed, ${failed} failed out of ${STUDENT_PACKS.length}`);
  console.log("=".repeat(64));
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  Deno.exit(1);
});
