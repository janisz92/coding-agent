import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function parsePatch(output: string): string {
  // 1) Preferowany format: "PATCH:"
  const idx = output.indexOf("PATCH:");
  let patchText = "";

  if (idx !== -1) {
    patchText = output.slice(idx + "PATCH:".length);
    patchText = patchText.replace(/^\s*\r?\n?/, "");
  } else {
    // 2) Fallback: model zwrócił sam diff bez "PATCH:"
    const diffIdx = output.indexOf("diff --git");
    if (diffIdx !== -1) {
      patchText = output.slice(diffIdx);
    } else {
      const preview = output.replace(/\s+/g, " ").slice(0, 300);
      throw new Error(
        `Brak sekcji PATCH i brak 'diff --git' w odpowiedzi modelu. Podgląd: ${preview}`
      );
    }
  }

  if (!patchText.startsWith("diff --git")) {
    const preview = patchText.replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`PATCH nie zaczyna się od 'diff --git'. Podgląd: ${preview}`);
  }

  return patchText.endsWith("\n") ? patchText : patchText + "\n";
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

export function checkPatch(repoRoot: string, patchPath: string): void {
  const res = spawnSync("git", ["apply", "--check", patchPath], {
    cwd: repoRoot,
    shell: false,
    encoding: "utf8",
  });

  if (res.status !== 0) {
    throw new Error(`git apply --check failed:\n${res.stdout}\n${res.stderr}`);
  }
}
