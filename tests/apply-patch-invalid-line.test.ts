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

test("apply_patch rejects invalid body line (no prefix)", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-patch-invalid-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const file = path.join(repoDir, "a.txt");
  fs.writeFileSync(file, "one\ntwo\n", "utf8");

  const tools = new RepoTools(defaultOpts(repoDir));

  // Read existing file to satisfy precondition
  let res = await tools.dispatch({ name: "read_file", arguments: { path: "a.txt" } } as any);
  assert.equal(res.ok, true, res.error ?? "read_file failed");

  const patch = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "Xthis line is invalid because it lacks a valid prefix",
  ].join("\n");

  res = await tools.dispatch({ name: "apply_patch", arguments: { patch } } as any);
  assert.equal(res.ok, false, "apply_patch should fail on invalid line");
  assert.match(String(res.error ?? ""), /Invalid patch line/);
});
