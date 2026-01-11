import { spawnSync } from "node:child_process";

function run(repoRoot: string, args: string[]) {
  const res = spawnSync("git", args, {
    cwd: repoRoot,
    shell: false,
    encoding: "utf8",
  });

  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

export function ensureGitRepo(repoRoot: string) {
  const r = run(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!(r.code === 0 && r.stdout.trim() === "true")) {
    throw new Error("To nie jest repozytorium git. Zrób: git init + commit.");
  }
}

export function nameStatus(repoRoot: string): string {
  const r = run(repoRoot, ["diff", "--name-status"]);
  return r.code === 0 ? r.stdout.trim() : "";
}

export function stat(repoRoot: string): string {
  const r = run(repoRoot, ["diff", "--stat"]);
  return r.code === 0 ? r.stdout.trim() : "";
}

export function diff(repoRoot: string): string {
  const r = run(repoRoot, ["diff"]);
  return r.code === 0 ? r.stdout : "";
}
