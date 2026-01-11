import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";

import { RepoTools } from "../src/agent/tools.ts";
import { defaultSandboxOptions, createBaseline } from "../src/agent/run.ts";

test("baseline is created outside repo and list_changed_files works", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-baseline-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const filePath = path.join(repoDir, "a.txt");
  fs.writeFileSync(filePath, "one\n", "utf8");

  const sandbox = defaultSandboxOptions(repoDir);
  const b = createBaseline(sandbox);

  // Baseline exists and is not inside repoDir
  assert.equal(fs.existsSync(b.path), true, "baseline file should exist");
  const repoAbs = fs.realpathSync(repoDir) + path.sep;
  const baselineAbs = fs.realpathSync(b.path);
  assert.equal(baselineAbs.startsWith(repoAbs), false, "baseline must not be inside repo");

  // Ensure legacy baseline file is not created inside repo
  const legacy = path.join(repoDir, ".agent_baseline.json");
  assert.equal(fs.existsSync(legacy), false, "legacy baseline file should not be present in repo");

  // Modify a file and ensure list_changed_files reports it
  fs.writeFileSync(filePath, "two\n", "utf8");

  const tools = new RepoTools({ ...(sandbox as any), baselinePath: b.path } as any);
  const res = await tools.dispatch({ name: "list_changed_files", arguments: {} } as any);
  assert.equal(res.ok, true, res.error ?? "list_changed_files failed");
  const out = res.result as any;
  assert.ok(Array.isArray(out.modified));
  assert.ok(out.modified.includes("a.txt"), "modified should include a.txt");
});
