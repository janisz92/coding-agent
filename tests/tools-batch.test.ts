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

test("read_files_batch reads contents and unlocks write_file", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-batch-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const fileA = path.join(repoDir, "a.txt");
  fs.writeFileSync(fileA, "hello\n", "utf8");

  const tools = new RepoTools(defaultOpts(repoDir));

  // Attempt to write without prior read: should fail
  let res = await tools.dispatch({ name: "write_file", arguments: { path: "a.txt", content: "world\n" } } as any);
  assert.equal(res.ok, false, "write_file should enforce prior read for existing file");
  assert.match(res.error || "", /MUST read_file before write_file/);

  // Batch read
  res = await tools.dispatch({ name: "read_files_batch", arguments: { paths: ["a.txt"] } } as any);
  assert.equal(res.ok, true, res.error ?? "read_files_batch failed");
  const arr = res.result as any[];
  assert.ok(Array.isArray(arr));
  assert.equal(arr.length, 1);
  assert.equal(arr[0].path, "a.txt");
  assert.equal(arr[0].content, "hello\n");

  // Now write should succeed
  res = await tools.dispatch({ name: "write_file", arguments: { path: "a.txt", content: "world\n" } } as any);
  assert.equal(res.ok, true, res.error ?? "write_file after batch read failed");
});

test("read_files_batch marks too large files with note and null content", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-batch-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const big = path.join(repoDir, "big.txt");
  // Create a file larger than maxReadBytes (400_000)
  const buf = Buffer.alloc(450_000, 0x61); // 'a'
  fs.writeFileSync(big, buf);

  const tools = new RepoTools(defaultOpts(repoDir));
  const res = await tools.dispatch({ name: "read_files_batch", arguments: { paths: ["big.txt"] } } as any);
  assert.equal(res.ok, true, res.error ?? "read_files_batch failed");
  const arr = res.result as any[];
  assert.equal(arr.length, 1);
  assert.equal(arr[0].path, "big.txt");
  assert.equal(arr[0].content, null);
  assert.ok(arr[0].note, "note should be present for too_large");
});

test("stat_files_batch returns exists/is_file/bytes", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-batch-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const a = path.join(repoDir, "a.txt");
  fs.writeFileSync(a, "x\n", "utf8");

  const tools = new RepoTools(defaultOpts(repoDir));
  const res = await tools.dispatch({ name: "stat_files_batch", arguments: { paths: ["a.txt", "missing.txt"] } } as any);
  assert.equal(res.ok, true, res.error ?? "stat_files_batch failed");
  const arr = res.result as any[];
  assert.equal(arr.length, 2);

  const one = arr.find((x: any) => x.path === "a.txt");
  assert.ok(one, "should include a.txt");
  assert.equal(one.exists, true);
  assert.equal(one.is_file, true);
  assert.equal(typeof one.bytes, "number");

  const two = arr.find((x: any) => x.path === "missing.txt");
  assert.ok(two, "should include missing.txt");
  assert.equal(two.exists, false);
  assert.equal(two.is_file, false);
  assert.equal(two.bytes, 0);
});

test("read_files_batch rejects too many paths", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-batch-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const tools = new RepoTools(defaultOpts(repoDir));
  const many = Array.from({ length: 51 }, (_, i) => `f${i}.txt`);
  const res = await tools.dispatch({ name: "read_files_batch", arguments: { paths: many } } as any);
  assert.equal(res.ok, false, "should error on too many paths");
});
