import path from "node:path";
import fs from "node:fs";

export type SandboxOptions = {
  repoRoot: string;
  denyDirs: string[]; // np. [".git", "node_modules", "dist"]
  denyFilesExact: string[]; // np. [".env"]
  denyExtensions: string[]; // np. [".pem", ".key"]
  maxReadBytes: number; // np. 400_000
  maxWriteBytes: number; // np. 800_000
  // Ścieżka do pliku snapshotu baseline (poza repo), przekazywana do RepoTools przez run.ts
  baselinePath?: string;
};

export type SafePathResult = {
  absPath: string;
  relPath: string; // zawsze POSIX ("/")
};

/**
 * Sprawdza denylistę na ścieżce relatywnej (POSIX).
 */
export function isDeniedPath(opts: SandboxOptions, relPosixPath: string): boolean {
  const pRaw = relPosixPath.replace(/^\/+/, ""); // bez wiodących /
  const p = pRaw.toLowerCase();

  const denyFiles = opts.denyFilesExact.map((s) => s.toLowerCase());
  const denyExts = opts.denyExtensions.map((s) => s.toLowerCase());
  const denyDirs = opts.denyDirs.map((s) => s.toLowerCase());

  // zablokuj pliki dokładne
  const base = path.posix.basename(p);
  if (denyFiles.includes(base)) return true;

  // zablokuj rozszerzenia
  const ext = path.posix.extname(base);
  if (ext && denyExts.includes(ext)) return true;

  // zablokuj katalogi na dowolnym poziomie
  const segments = p.split("/");
  for (const seg of segments) {
    if (denyDirs.includes(seg)) return true;
  }

  return false;
}

/**
 * Normalizuje ścieżkę i blokuje path traversal.
 * Zwraca relPath (POSIX) i absPath.
 */
export function resolveInRepo(opts: SandboxOptions, userPath: string): SafePathResult {
  if (typeof userPath !== "string") {
    throw new Error("Invalid path: expected string");
  }
  if (userPath.includes("\u0000")) {
    throw new Error("Invalid path: null byte");
  }
  const userPathTrimmed = userPath.trim();
  if (!userPathTrimmed) {
    throw new Error(`Invalid path: "${userPath}"`);
  }

  const realRepoAbs = fs.realpathSync(path.resolve(opts.repoRoot));
  const candidateAbs = path.resolve(realRepoAbs, userPathTrimmed);

  // Ustal realną ścieżkę kandydata z obsługą nieistniejącego pliku
  let realCandidateAbs: string;
  try {
    realCandidateAbs = fs.realpathSync(candidateAbs);
  } catch {
    const parent = path.dirname(candidateAbs);
    const base = path.basename(candidateAbs);
    let realParent: string;
    try {
      realParent = fs.realpathSync(parent);
    } catch {
      throw new Error(`Invalid path: "${userPath}"`);
    }
    realCandidateAbs = path.join(realParent, base);
  }

  // Warunek bezpieczeństwa: musi zaczynać się od realRepoAbs + path.sep
  const mustStart = realRepoAbs + path.sep;
  if (!realCandidateAbs.startsWith(mustStart)) {
    throw new Error(`Path traversal blocked: "${userPath}"`);
  }

  // Oblicz relatywną ścieżkę na podstawie realnych ścieżek
  const relFromRepo = path.relative(realRepoAbs, realCandidateAbs);
  const relPosix = relFromRepo.replaceAll(path.sep, "/");

  if (!relPosix || relPosix.trim() === "") {
    // root repo lub pusta ścieżka
    throw new Error(`Invalid path: "${userPath}"`);
  }

  // Zablokuj katalogi – ta funkcja zwraca ścieżki tylko do plików
  try {
    if (fs.existsSync(realCandidateAbs)) {
      const st = fs.lstatSync(realCandidateAbs);
      if (st.isDirectory()) {
        throw new Error(`Invalid path: "${userPath}"`);
      }
    }
  } catch {
    throw new Error(`Invalid path: "${userPath}"`);
  }

  if (isDeniedPath(opts, relPosix)) {
    throw new Error(`Access denied by policy: "${relPosix}"`);
  }

  return { absPath: realCandidateAbs, relPath: relPosix };
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
  // Używamy realpath repo, aby sprawdzać, że wchodzimy tylko do realnych ścieżek w repo
  let repoRealAbs = repoAbs;
  try {
    repoRealAbs = fs.realpathSync(repoAbs);
  } catch {
    // jeśli realpath się nie powiedzie, zachowujemy repoAbs; kolejne sprawdzenia i tak będą defensywne
  }
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
      // Nie polegamy na Dirent – używamy lstatSync, aby wykryć symlinki
      let st: fs.Stats;
      try {
        st = fs.lstatSync(childAbs);
      } catch {
        continue; // nieczytelny wpis – pomijamy
      }

      // Pomijamy symlinki (zarówno do plików, jak i katalogów),
      // aby uniknąć ucieczki poza repo przez dowiązania symboliczne
      if (st.isSymbolicLink()) {
        continue;
      }

      if (st.isDirectory()) {
        // Przed wejściem do katalogu sprawdzamy realną ścieżkę –
        // jeśli nie zaczyna się od realpath(repoRoot), pomijamy
        let childReal: string;
        try {
          childReal = fs.realpathSync(childAbs);
        } catch {
          continue;
        }
        const mustStart = repoRealAbs + path.sep;
        if (!childReal.startsWith(mustStart)) {
          continue;
        }
        walk(childAbs);
      } else if (st.isFile()) {
        results.push(rel);
      }
    }
  }

  walk(repoAbs);
  return results.sort();
}
