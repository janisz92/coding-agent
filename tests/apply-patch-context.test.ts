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

test("apply_patch: contextual fragment replacement works", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-ctx-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const file = path.join(repoDir, "a.txt");
  fs.writeFileSync(file, "one\ntwo\nthree\n", "utf8");

  const tools = new RepoTools(defaultOpts(repoDir));
  // Enforce read before patching existing file
  let res = await tools.dispatch({ name: "read_file", arguments: { path: "a.txt" } } as any);
  assert.equal(res.ok, true, res.error ?? "read_file failed");

  const patch = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "-two",
    "+TWO",
  ].join("\n");

  res = await tools.dispatch({ name: "apply_patch", arguments: { patch } } as any);
  assert.equal(res.ok, true, res.error ?? "apply_patch failed");

  const updated = fs.readFileSync(file, "utf8");
  assert.equal(updated, "one\nTWO\nthree\n");
});

test("apply_patch: two occurrences of base fragment cause error", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-ctx-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const file = path.join(repoDir, "a.txt");
  fs.writeFileSync(file, "x\ny\nx\n", "utf8");

  const tools = new RepoTools(defaultOpts(repoDir));
  let res = await tools.dispatch({ name: "read_file", arguments: { path: "a.txt" } } as any);
  assert.equal(res.ok, true, res.error ?? "read_file failed");

  const patch = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "-x",
    "+X",
  ].join("\n");

  res = await tools.dispatch({ name: "apply_patch", arguments: { patch } } as any);
  assert.equal(res.ok, false, "apply_patch should fail on ambiguous fragment");
  assert.match(String(res.error ?? ""), /expected exactly one occurrence/);
});

test("apply_patch: zero occurrences of base fragment cause error", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-ctx-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const file = path.join(repoDir, "a.txt");
  fs.writeFileSync(file, "a\nb\nc\n", "utf8");

  const tools = new RepoTools(defaultOpts(repoDir));
  let res = await tools.dispatch({ name: "read_file", arguments: { path: "a.txt" } } as any);
  assert.equal(res.ok, true, res.error ?? "read_file failed");

  const patch = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "-zzz",
    "+ZZZ",
  ].join("\n");

  res = await tools.dispatch({ name: "apply_patch", arguments: { patch } } as any);
  assert.equal(res.ok, false, "apply_patch should fail when fragment not found");
  assert.match(String(res.error ?? ""), /expected exactly one occurrence/);
});
