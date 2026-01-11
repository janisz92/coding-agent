import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

import { generateText } from "./openai.ts";
import { buildPatchPrompt, buildReviewPrompt } from "./prompts.ts";
import { parsePatch, savePatch, applyPatch, cleanupPatchFile } from "./patch.ts";
import { ensureGitRepo, nameStatus, stat, diff as gitDiff } from "./git.ts";
import { listFiles, pickContextFiles, readFile, repoMap } from "./repo.ts";

function getArgValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx === -1 ? undefined : argv[idx + 1];
}

async function main() {
  const cmd = process.argv[2];
  const repoRoot = path.resolve(getArgValue(process.argv, "--repo") ?? process.cwd());

  ensureGitRepo(repoRoot);

  if (cmd === "review") {
    const ns = nameStatus(repoRoot);
    const d = gitDiff(repoRoot);

    if (!d.trim()) {
      console.log("[agent] Brak zmian do review.");
      return;
    }

    const prompt = buildReviewPrompt({
      repoRoot,
      nameStatus: ns,
      diffText: d.slice(0, 20000),
    });

    const out = await generateText(prompt);
    console.log("\n=== REVIEW ===\n");
    console.log(out);
    return;
  }

  if (cmd !== "patch") {
    console.log(`
Użycie:
  patch  "OPIS ZADANIA" --repo <ścieżka>
  review --repo <ścieżka>
`);
    return;
  }

  const repoIdx = process.argv.indexOf("--repo");
  const task = (
    repoIdx === -1
      ? process.argv.slice(3)
      : process.argv.slice(3, repoIdx)
  ).join(" ").trim();

  if (!task) throw new Error("Brak opisu zadania.");

  const files = listFiles(repoRoot);
  const contextPaths = pickContextFiles(files);
  const context = contextPaths.map((p) => ({
    path: p,
    content: readFile(repoRoot, p),
  }));

  const prompt = buildPatchPrompt({
    task,
    repoRoot,
    repoMap: repoMap(files),
    files: context,
  });

  console.log("[agent] Working...");
  const output = await generateText(prompt);

  const patch = parsePatch(output);
  const patchPath = savePatch(repoRoot, patch);

  applyPatch(repoRoot, patchPath);
  cleanupPatchFile(patchPath);

  console.log("\n[agent] Zastosowano zmiany.");
  console.log("\nPliki:");
  console.log(nameStatus(repoRoot) || "(brak)");

  console.log("\nPodsumowanie:");
  console.log(stat(repoRoot) || "(brak)");

  console.log("\n➡ Przejrzyj zmiany w VS Code (Source Control).");
  console.log("➡ Ty decydujesz czy robić commit.");
}

main().catch((e) => {
  console.error("[agent] ERROR:", e.message);
  process.exit(1);
});
