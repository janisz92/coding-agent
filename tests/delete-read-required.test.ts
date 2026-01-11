import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";

import { RepoTools } from "../src/agent/tools.ts";
import type { SandboxOptions } from "../src/agent/security.ts";

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

test("delete_file requires prior read_file for existing file", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-del-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const file = path.join(repoDir, "a.txt");
  fs.writeFileSync(file, "data\n", "utf8");

  const tools = new RepoTools(defaultOpts(repoDir));

  // Attempt delete without prior read: should fail
  let res = await tools.dispatch({ name: "delete_file", arguments: { path: "a.txt" } } as any);
  assert.equal(res.ok, false, "delete_file should enforce prior read for existing file");
  assert.match(String(res.error ?? ""), /MUST read_file before delete_file/);

  // Read then delete should succeed
  res = await tools.dispatch({ name: "read_file", arguments: { path: "a.txt" } } as any);
  assert.equal(res.ok, true, res.error ?? "read_file failed");

  res = await tools.dispatch({ name: "delete_file", arguments: { path: "a.txt" } } as any);
  assert.equal(res.ok, true, res.error ?? "delete_file failed after read");
  assert.equal((res.result as any).deleted, true);
  assert.equal(fs.existsSync(file), false, "file should be removed");
});
