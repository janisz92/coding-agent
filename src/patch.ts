import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function parsePatch(output: string): string {
  const idx = output.indexOf("PATCH:");
  if (idx === -1) {
    throw new Error("Brak sekcji PATCH w odpowiedzi modelu.");
  }

  let patch = output.slice(idx + "PATCH:".length);
  patch = patch.replace(/^\s*\r?\n?/, "");

  if (!patch.startsWith("diff --git")) {
    throw new Error("PATCH nie zaczyna się od 'diff --git'.");
  }

  return patch.endsWith("\n") ? patch : patch + "\n";
}

export function savePatch(repoRoot: string, patch: string): string {
  const file = path.join(repoRoot, "agent.patch");
  fs.writeFileSync(file, patch, "utf8");
  return file;
}

export function applyPatch(repoRoot: string, patchPath: string): void {
  const res = spawnSync("git", ["apply", "--whitespace=fix", patchPath], {
    cwd: repoRoot,
    shell: false,
    encoding: "utf8",
  });

  if (res.status !== 0) {
    throw new Error(`git apply failed:\n${res.stdout}\n${res.stderr}`);
  }
}

export function cleanupPatchFile(patchPath: string) {
  try {
    if (fs.existsSync(patchPath)) fs.unlinkSync(patchPath);
  } catch {
    /* ignore */
  }
}
