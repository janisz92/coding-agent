import "dotenv/config";
import path from "node:path";

import { runAgent } from "./agent/run.ts";

function getArgValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx === -1 ? undefined : argv[idx + 1];
}

function usage() {
  console.log(`
Użycie:
  npm run dev -- edit "<OPIS>" --repo <ścieżka>

Opis:
  edit uruchamia agentową pętlę tool-calling.
  Agent czyta i zapisuje pliki bezpośrednio (bez patchy jako mechanizmu zmian),
  loguje przebieg do agent.raw.txt oraz zapisuje raport git diff do agent.diff.txt (jeśli możliwe).
`);
}

async function main() {
  const cmd = process.argv[2];

  if (!cmd) {
    usage();
    process.exitCode = 1;
    return;
  }

  const normalizedCmd = cmd.toLowerCase();
  const isEdit = normalizedCmd === "edit";

  if (!isEdit) {
    usage();
    process.exitCode = 1;
    return;
  }

  // Walidacja argumentu --repo pod kątem placeholderów
  const rawRepoArg = getArgValue(process.argv, "--repo");
  if (rawRepoArg && /[<>]/.test(rawRepoArg)) {
    console.error(
      "[agent] ERROR: Wykryto placeholder w argumencie --repo. Podaj prawdziwą ścieżkę do repozytorium.\n",
    );
    console.error("Przykład: --repo .    lub    --repo /pełna/ścieżka/do/repo");
    process.exitCode = 1;
    return;
  }

  const repoRoot = path.resolve(rawRepoArg ?? process.cwd());

  // Task to wszystko pomiędzy komendą a --repo
  const repoIdx = process.argv.indexOf("--repo");
  const taskParts = repoIdx === -1 ? process.argv.slice(3) : process.argv.slice(3, repoIdx);
  const task = taskParts.join(" ").trim();

  if (!task) {
    console.error("[agent] ERROR: Brak opisu zadania.");
    usage();
    process.exitCode = 1;
    return;
  }

  console.log("[agent] Working (tool-calling loop)...");
  await runAgent({ repoRoot, task, model: process.env.OPENAI_MODEL ?? "gpt-5", maxToolCalls: 50 });

  console.log("[agent] Done.");
  console.log(`- Log: ${path.join(repoRoot, "agent.raw.txt")}`);
  console.log(`- Diff: ${path.join(repoRoot, "agent.diff.txt")} (jeśli git diff działa)`);
  console.log("Przejrzyj zmiany w VS Code → Source Control.");
}

main().catch((e: any) => {
  console.error("[agent] ERROR:", e?.stack ?? e?.message ?? String(e));
  process.exitCode = 1;
});
