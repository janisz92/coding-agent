import path from "node:path";
import fs from "node:fs";

export type SandboxOptions = {
  repoRoot: string;
  denyDirs: string[]; // np. [".git", "node_modules", "dist"]
  denyFilesExact: string[]; // np. [".env"]
  denyExtensions: string[]; // np. [".pem", ".key"]
  maxReadBytes: number; // np. 400_000
  maxWriteBytes: number; // np. 800_000
};

export type SafePathResult = {
  absPath: string;
  relPath: string; // zawsze POSIX ("/")
};

/**
 * Sprawdza denylistę na ścieżce relatywnej (POSIX).
 */
export function isDeniedPath(opts: SandboxOptions, relPosixPath: string): boolean {
  const p = relPosixPath.replace(/^\/+/, ""); // bez wiodących /

  // zablokuj pliki dokładne
  const base = path.posix.basename(p);
  if (opts.denyFilesExact.includes(base)) return true;

  // zablokuj rozszerzenia
  const ext = path.posix.extname(base).toLowerCase();
  if (ext && opts.denyExtensions.map((e) => e.toLowerCase()).includes(ext)) return true;

  // zablokuj katalogi na dowolnym poziomie
  const segments = p.split("/");
  for (const seg of segments) {
    if (opts.denyDirs.includes(seg)) return true;
  }

  return false;
}

/**
 * Normalizuje ścieżkę i blokuje path traversal.
 * Zwraca relPath (POSIX) i absPath.
 */
export function resolveInRepo(opts: SandboxOptions, userPath: string): SafePathResult {
  const repoAbs = path.resolve(opts.repoRoot);
  const candidateAbs = path.resolve(repoAbs, userPath);

  const relFromRepo = path.relative(repoAbs, candidateAbs);

  // Blokada wyjścia poza repo
  const traversal =
    relFromRepo === "" ||
    relFromRepo === "." ||
    relFromRepo === ".." ||
    relFromRepo.startsWith(".." + path.sep) ||
    relFromRepo.includes(path.sep + ".." + path.sep);

  if (traversal) {
    throw new Error(`Path traversal blocked: "${userPath}"`);
  }

  const relPosix = relFromRepo.replaceAll(path.sep, "/");
  if (!relPosix || relPosix.trim() === "") {
    throw new Error(`Invalid path: "${userPath}"`);
  }

  if (isDeniedPath(opts, relPosix)) {
    throw new Error(`Access denied by policy: "${relPosix}"`);
  }

  return { absPath: candidateAbs, relPath: relPosix };
}

export function ensureParentDirExists(fileAbsPath: string): void {
  const dir = path.dirname(fileAbsPath);
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Bezpieczne listowanie plików w repo (z ignorowaniem denylist).
 * Zwraca relatywne ścieżki POSIX.
 */
export function listFilesRecursive(opts: SandboxOptions, maxFiles = 5000): string[] {
  const repoAbs = path.resolve(opts.repoRoot);
  const results: string[] = [];

  function walk(dirAbs: string) {
    if (results.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      if (results.length >= maxFiles) return;

      const childAbs = path.join(dirAbs, e.name);
      const rel = path.relative(repoAbs, childAbs).replaceAll(path.sep, "/");

      if (!rel || isDeniedPath(opts, rel)) continue;

      if (e.isDirectory()) {
        walk(childAbs);
      } else if (e.isFile()) {
        results.push(rel);
      }
    }
  }

  walk(repoAbs);
  return results.sort();
}
