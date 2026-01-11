import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveInRepo, isDeniedPath, type SandboxOptions } from "../src/agent/security.ts";

function defaultOpts(repoRoot: string): SandboxOptions {
  return {
    repoRoot,
    denyDirs: [".git", "node_modules", "dist"],
    denyFilesExact: [".env"],
    denyExtensions: [".pem", ".key"],
    maxReadBytes: 400_000,
    maxWriteBytes: 800_000,
  };
}

function repoRootFromTests(): string {
  // tests/ -> repo root
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "..");
}

test("resolveInRepo: poprawna ścieżka src/cli.ts", () => {
  const repoRoot = repoRootFromTests();
  const opts = defaultOpts(repoRoot);
  const res = resolveInRepo(opts, "src/cli.ts");
  assert.equal(res.relPath, "src/cli.ts");
  assert.ok(fs.existsSync(res.absPath), "absPath powinien istnieć");
  const st = fs.statSync(res.absPath);
  assert.ok(st.isFile(), "powinien być plikiem");
});

test("resolveInRepo: blokada ../x (path traversal)", () => {
  const repoRoot = repoRootFromTests();
  const opts = defaultOpts(repoRoot);
  assert.throws(() => resolveInRepo(opts, "../x"), /Path traversal blocked/);
});

test("resolveInRepo: blokada ucieczki przez symlink poza repo", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-sec-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  // plik poza repo
  const outsideFile = path.join(base, "outside.txt");
  fs.writeFileSync(outsideFile, "outside");

  // symlink w repo wskazujący poza repo
  const linkPath = path.join(repoDir, "link-out.txt");
  try {
    fs.symlinkSync(outsideFile, linkPath);
  } catch (e) {
    // Na niektórych systemach tworzenie symlinków może wymagać uprawnień.
    // Jeśli nie można utworzyć symlinka, pomiń test.
    console.warn("[test] pominięto tworzenie symlinków:", (e as any)?.message ?? e);
    return;
  }

  const opts = defaultOpts(repoDir);
  assert.throws(() => resolveInRepo(opts, "link-out.txt"), /Path traversal blocked/);
});

test("denylist: case-insensitive .Git", () => {
  const repoRoot = repoRootFromTests();
  const opts = defaultOpts(repoRoot);

  // isDeniedPath bezpośrednio
  assert.equal(isDeniedPath(opts, ".Git/config"), true);

  // resolveInRepo powinno zablokować dostęp
  assert.throws(() => resolveInRepo(opts, ".Git/config"), /Access denied by policy/);
});
