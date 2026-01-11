import fs from "node:fs";
import path from "node:path";

const IGNORE = new Set([
  "node_modules",
  ".git",
  "target",
  "build",
  "dist",
  ".idea",
  ".gradle",
  ".mvn",
]);

export function listFiles(repoRoot: string, max = 2000): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    if (files.length >= max) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORE.has(entry.name)) continue;

      const full = path.join(dir, entry.name);
      const rel = path.relative(repoRoot, full).replaceAll("\\", "/");

      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        if (fs.statSync(full).size < 400_000) files.push(rel);
      }
    }
  }

  walk(repoRoot);
  return files.sort();
}

export function pickContextFiles(all: string[]): string[] {
  const important = ["pom.xml", "build.gradle", "build.gradle.kts"];

  const result = all.filter((f) => important.includes(f.toLowerCase()));
  result.push(...all.filter((f) => f.startsWith("src/main/")).slice(0, 8));
  result.push(...all.filter((f) => f.startsWith("src/test/")).slice(0, 8));

  return Array.from(new Set(result)).slice(0, 16);
}

export function readFile(repoRoot: string, rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

export function repoMap(files: string[]): string {
  return files.slice(0, 500).join("\n");
}
