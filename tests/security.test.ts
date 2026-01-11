import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { resolveInRepo, isDeniedPath, SandboxOptions } from "../src/agent/security.ts";

function makeTempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-sec-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  return dir;
}

test("resolveInRepo blocks traversal", () => {
  const repoRoot = makeTempRoot();

  const opts: SandboxOptions = {
    repoRoot,
    denyDirs: [".git", "node_modules", "dist"],
    denyFilesExact: [".env"],
    denyExtensions: [".pem", ".key"],
    maxReadBytes: 400_000,
    maxWriteBytes: 800_000,
  };

  assert.throws(() => resolveInRepo(opts, "../outside.txt"));
  assert.throws(() => resolveInRepo(opts, "..\\outside.txt"));
});

test("resolveInRepo allows normal paths", () => {
  const repoRoot = makeTempRoot();

  const opts: SandboxOptions = {
    repoRoot,
    denyDirs: [".git", "node_modules", "dist"],
    denyFilesExact: [".env"],
    denyExtensions: [".pem", ".key"],
    maxReadBytes: 400_000,
    maxWriteBytes: 800_000,
  };

  const r = resolveInRepo(opts, "src/index.ts");
  assert.equal(r.relPath, "src/index.ts");
  assert.ok(r.absPath.includes(repoRoot));
});

test("denylist blocks .git and node_modules", () => {
  const repoRoot = makeTempRoot();

  const opts: SandboxOptions = {
    repoRoot,
    denyDirs: [".git", "node_modules", "dist"],
    denyFilesExact: [".env"],
    denyExtensions: [".pem", ".key"],
    maxReadBytes: 400_000,
    maxWriteBytes: 800_000,
  };

  assert.equal(isDeniedPath(opts, ".git/config"), true);
  assert.equal(isDeniedPath(opts, "node_modules/a.js"), true);
  assert.equal(isDeniedPath(opts, "dist/b.js"), true);
});

test("denylist blocks .env and key files", () => {
  const repoRoot = makeTempRoot();

  const opts: SandboxOptions = {
    repoRoot,
    denyDirs: [".git", "node_modules", "dist"],
    denyFilesExact: [".env"],
    denyExtensions: [".pem", ".key"],
    maxReadBytes: 400_000,
    maxWriteBytes: 800_000,
  };

  assert.equal(isDeniedPath(opts, ".env"), true);
  assert.equal(isDeniedPath(opts, "secrets/private.key"), true);
  assert.equal(isDeniedPath(opts, "certs/server.pem"), true);
});
