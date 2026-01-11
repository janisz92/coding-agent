import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { RepoTools } from "../src/agent/tools.ts";
import { SandboxOptions } from "../src/agent/security.ts";

function makeTempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tools-"));
  return dir;
}

test("review tools: list_changed_files and diff_file_against_original", async () => {
  const repoRoot = makeTempRoot();

  // initial file
  fs.writeFileSync(path.join(repoRoot, "a.txt"), "hello\n", "utf8");

  // baseline snapshot
  const baseline = {
    createdAt: new Date().toISOString(),
    maxReadBytes: 400_000,
    files: {
      "a.txt": { bytes: Buffer.byteLength("hello\n", "utf8"), content: "hello\n" },
    },
  };
  fs.writeFileSync(path.join(repoRoot, ".agent_baseline.json"), JSON.stringify(baseline, null, 2), "utf8");

  // change file
  fs.writeFileSync(path.join(repoRoot, "a.txt"), "hello world\n", "utf8");

  const opts: SandboxOptions = {
    repoRoot,
    denyDirs: [".git", "node_modules", "dist"],
    denyFilesExact: [".env"],
    denyExtensions: [".pem", ".key"],
    maxReadBytes: 400_000,
    maxWriteBytes: 800_000,
  };

  const tools = new RepoTools(opts);

  const changed = await tools.dispatch({ name: "list_changed_files", arguments: { limit: 100 } as any });
  assert.equal(changed.ok, true);
  assert.ok(changed.result.modified.includes("a.txt"));

  const diffRes = await tools.dispatch({ name: "diff_file_against_original", arguments: { path: "a.txt" } as any });
  assert.equal(diffRes.ok, true);
  assert.equal(diffRes.result.status, "modified");
  assert.ok(typeof diffRes.result.diff_text === "string");
  assert.ok(diffRes.result.diff_text.includes("--- a/a.txt"));
  assert.ok(diffRes.result.diff_text.includes("+++ b/a.txt"));
  assert.ok(diffRes.result.diff_text.includes("-hello"));
  assert.ok(diffRes.result.diff_text.includes("+hello world"));
});
