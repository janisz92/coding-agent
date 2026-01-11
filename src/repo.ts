import fs from "node:fs";
import path from "node:path";

const IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "target",
  ".idea",
  ".gradle",
  ".mvn"
]);

export function listFiles(repoRoot: string, max = 1000): string[] {
  const out: string[] = [];

  function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORE.has(e.name)) continue;

      const full = path.join(dir, e.name);
      const rel = path.relative(repoRoot, full).replaceAll("\\", "/");

      if (e.isDirectory()) walk(full);
      else if (e.isFile() && fs.statSync(full).size < 300_000) out.push(rel);
    }
  }

  walk(repoRoot);
  return out.slice(0, max);
}

export function pickContextFiles(all: string[]): string[] {
  return all.filter((f) =>
    f.startsWith("src/") || f.endsWith(".json") || f.endsWith(".yml")
  ).slice(0, 12);
}

export function readFile(repoRoot: string, rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

export function repoMap(files: string[]): string {
  return files.slice(0, 300).join("\n");
}
