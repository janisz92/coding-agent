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

test("search_in_files: ignores symlink pointing outside repo and does not crash", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-search-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  // Create a regular file inside repo (does not contain the query)
  const insideFile = path.join(repoDir, "inside.txt");
  fs.writeFileSync(insideFile, "hello inside\nno secrets here\n");

  // Create a file outside repo that contains the query
  const outsideFile = path.join(base, "outside.txt");
  fs.writeFileSync(outsideFile, "this contains secret-token which should not be read\n");

  // Symlink inside repo pointing to outside file
  const linkPath = path.join(repoDir, "link-out.txt");
  try {
    fs.symlinkSync(outsideFile, linkPath);
  } catch (e) {
    console.warn("[test] symlink creation skipped:", (e as any)?.message ?? e);
    return; // skip test on systems without symlink permissions
  }

  const tools = new RepoTools(defaultOpts(repoDir));
  const res = await tools.dispatch({
    name: "search_in_files",
    arguments: { query: "secret-token", limit_files: 100, limit_matches: 50 },
  } as any);

  assert.equal(res.ok, true, res.error ?? "search_in_files failed");
  const out: any = res.result;
  assert.ok(out && typeof out === "object");
  assert.equal(Array.isArray(out.matches), true);
  // Should not find matches from the symlink pointing outside the repo
  assert.equal(out.matches.length, 0);
});
