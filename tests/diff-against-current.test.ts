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

test("diff_file_against_current: returns unified diff vs proposed content and does not modify file", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-diff-cur-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const file = path.join(repoDir, "a.txt");
  fs.writeFileSync(file, "one\ntwo\n", "utf8");

  const tools = new RepoTools(defaultOpts(repoDir));
  const res = await tools.dispatch({
    name: "diff_file_against_current",
    arguments: { path: "a.txt", proposed_content: "one\nTWO\nthree\n" },
  } as any);

  assert.equal(res.ok, true, res.error ?? "diff_file_against_current failed");
  const out = res.result as any;
  assert.ok(out && typeof out === "object");
  assert.equal(typeof out.diff_text, "string");
  assert.match(out.diff_text, /--- a\/a.txt\n\+\+\+ b\/a.txt/);
  assert.ok(out.diff_text.includes("-two"), "should include removed line");
  assert.ok(out.diff_text.includes("+TWO"), "should include added line");
  assert.ok(out.diff_text.includes("+three"), "should include newly added line");

  // Ensure file was not modified on disk
  const current = fs.readFileSync(file, "utf8");
  assert.equal(current, "one\ntwo\n");
});

test("diff_file_against_current: when file missing, current is treated as empty", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-diff-cur-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const tools = new RepoTools(defaultOpts(repoDir));
  const res = await tools.dispatch({
    name: "diff_file_against_current",
    arguments: { path: "missing.txt", proposed_content: "x\ny\n" },
  } as any);

  assert.equal(res.ok, true, res.error ?? "diff_file_against_current failed");
  const diff = (res.result as any).diff_text as string;
  assert.match(diff, /--- a\/missing.txt\n\+\+\+ b\/missing.txt/);
  assert.ok(diff.includes("+x"));
  assert.ok(diff.includes("+y"));
});

test("diff_file_against_current: respects max_lines limit for body", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repo-diff-cur-"));
  const repoDir = path.join(base, "repo");
  fs.mkdirSync(repoDir);

  const file = path.join(repoDir, "c.txt");
  fs.writeFileSync(file, "a1\na2\na3\na4\n", "utf8");

  const tools = new RepoTools(defaultOpts(repoDir));
  const res = await tools.dispatch({
    name: "diff_file_against_current",
    arguments: { path: "c.txt", proposed_content: "b1\nb2\nb3\nb4\n", max_lines: 2 },
  } as any);

  assert.equal(res.ok, true, res.error ?? "diff_file_against_current failed");
  const diff = (res.result as any).diff_text as string;
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const body = lines.slice(2); // after headers
  assert.equal(body.length, 2, "body should be limited to max_lines");
});
