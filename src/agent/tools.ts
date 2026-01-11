import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  SandboxOptions,
  listFilesRecursive,
  resolveInRepo,
  ensureParentDirExists,
} from "./security.ts";

export type ToolName =
  | "list_files"
  | "read_file"
  | "read_files_batch"
  | "write_file"
  | "delete_file"
  | "stat_files_batch"
  | "search_in_files"
  | "get_baseline_info"
  | "list_changed_files"
  | "read_file_original"
  | "diff_file_against_original"
  | "diff_file_against_current"
  | "apply_patch";

export type ToolCall = {
  name: ToolName;
  arguments: any;
};

export type ToolResult = {
  ok: boolean;
  result?: any;
  error?: string;
};

const LCS_MAX_TOTAL_LINES = 10000; // hard limit for LCS-based diff

export class RepoTools {
  private readonly readFilesThisRun = new Set<string>();

  constructor(private readonly opts: SandboxOptions) {}

  /**
   * Specyfikacje narzędzi dla modelu (function calling).
   */
  getToolSpecs() {
    return [
      {
        type: "function",
        name: "list_files",
        description:
          "List files in the repository. Returns relative POSIX paths. Denylisted dirs/files are excluded.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            prefix: {
              type: "string",
              description: "Optional prefix filter (POSIX, e.g. 'src/' ).",
            },
            limit: {
              type: "integer",
              description: "Max number of files to return (default 2000).",
              minimum: 1,
              maximum: 5000,
            },
          },
        },
      },
      {
        type: "function",
        name: "read_file",
        description:
          "Read a text file from repo. MUST be called before modifying a file. Denylist and size limit apply.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Relative path inside repo." },
          },
          required: ["path"],
        },
      },
      {
        type: "function",
        name: "read_files_batch",
        description:
          "Read multiple text files from repo. Returns array of {path, bytes, content}. For files exceeding maxReadBytes, returns {path, bytes, content: null, note}. Denylist and size limit apply. Up to 50 paths per call.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            paths: {
              type: "array",
              description: "Relative paths inside repo.",
              items: { type: "string" },
              minItems: 1,
              maxItems: 50,
            },
          },
          required: ["paths"],
        },
      },
      {
        type: "function",
        name: "write_file",
        description:
          "Write (create/overwrite) a text file inside repo. Provide full new file content. Denylist and size limit apply.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Relative path inside repo." },
            content: { type: "string", description: "Full new file content." },
          },
          required: ["path", "content"],
        },
      },
      {
        type: "function",
        name: "delete_file",
        description:
          "Delete a file inside repo. Use only when explicitly needed. Denylist applies.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Relative path inside repo." },
          },
          required: ["path"],
        },
      },
      {
        type: "function",
        name: "stat_files_batch",
        description:
          "Stat multiple paths in repo. Returns array of {path, exists, is_file, bytes}. Denylist applies. Up to 200 paths per call.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            paths: {
              type: "array",
              description: "Relative paths inside repo.",
              items: { type: "string" },
              minItems: 1,
              maxItems: 200,
            },
          },
          required: ["paths"],
        },
      },
      {
        type: "function",
        name: "search_in_files",
        description:
          "Search for a substring in text files (simple contains). Returns matches with file and line numbers. Denylist and max file size apply.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", description: "Substring to search for." },
            prefix: { type: "string", description: "Optional path prefix filter, e.g. 'src/'." },
            limit_files: { type: "integer", minimum: 1, maximum: 2000 },
            limit_matches: { type: "integer", minimum: 1, maximum: 2000 },
          },
          required: ["query"],
        },
      },
      {
        type: "function",
        name: "get_baseline_info",
        description:
          "Get metadata about the initial repository snapshot used for review (created at agent start).",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        type: "function",
        name: "list_changed_files",
        description:
          "List added/modified/deleted files compared to the baseline snapshot (created at agent start).",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            prefix: { type: "string", description: "Optional path prefix filter, e.g. 'src/'." },
            limit: { type: "integer", minimum: 1, maximum: 5000 },
          },
        },
      },
      {
        type: "function",
        name: "read_file_original",
        description:
          "Read file content from the baseline snapshot (original version at agent start).",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Relative path inside repo." },
          },
          required: ["path"],
        },
      },
      {
        type: "function",
        name: "diff_file_against_original",
        description:
          "Compute a simple unified diff between current file content and the baseline (original). Returns summary and diff text.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Relative path inside repo." },
            max_lines: { type: "integer", description: "Max diff lines to include in output (default 2000).", minimum: 1, maximum: 10000 },
          },
          required: ["path"],
        },
      },
      {
        type: "function",
        name: "diff_file_against_current",
        description:
          "Compute a unified diff between CURRENT file content and the PROVIDED proposed_content (does not write). Returns diff_text matching buildUnifiedDiff format.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Relative path inside repo." },
            proposed_content: { type: "string", description: "Proposed new full file content to compare against current." },
            max_lines: { type: "integer", description: "Max diff lines to include in output (default 2000).", minimum: 1, maximum: 10000 },
          },
          required: ["path", "proposed_content"],
        },
      },
      {
        type: "function",
        name: "apply_patch",
        description:
          "Apply a simple unified patch (without hunk headers) to one or more files. The format must match output of diff_file_against_original (lines starting with '--- a/', '+++ b/' followed by lines prefixed with space, '+' or '-'). Requires prior read_file for every existing file being modified.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            patch: { type: "string", description: "Unified patch text for one or more files." },
          },
          required: ["patch"],
        },
      },
    ] as const;
  }

  async dispatch(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case "list_files":
          return { ok: true, result: this.listFiles(call.arguments) };
        case "read_file":
          return { ok: true, result: this.readFile(call.arguments) };
        case "read_files_batch":
          return { ok: true, result: this.readFilesBatch(call.arguments) };
        case "write_file":
          return { ok: true, result: this.writeFile(call.arguments) };
        case "delete_file":
          return { ok: true, result: this.deleteFile(call.arguments) };
        case "stat_files_batch":
          return { ok: true, result: this.statFilesBatch(call.arguments) };
        case "search_in_files":
          return { ok: true, result: this.searchInFiles(call.arguments) };
        case "get_baseline_info":
          return { ok: true, result: this.getBaselineInfo() };
        case "list_changed_files":
          return { ok: true, result: this.listChangedFiles(call.arguments) };
        case "read_file_original":
          return { ok: true, result: this.readFileOriginal(call.arguments) };
        case "diff_file_against_original":
          return { ok: true, result: this.diffFileAgainstOriginal(call.arguments) };
        case "diff_file_against_current":
          return { ok: true, result: this.diffFileAgainstCurrent(call.arguments) };
        case "apply_patch":
          return { ok: true, result: this.applyPatch(call.arguments) };
        default:
          return { ok: false, error: `Unknown tool: ${(call as any).name}` };
      }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  private listFiles(args: { prefix?: string; limit?: number }) {
    const all = listFilesRecursive(this.opts, 5000);
    const prefix = (args.prefix ?? "").trim();
    let out = all;
    if (prefix) out = out.filter((p) => p.startsWith(prefix));
    const limit = Math.min(Math.max(args.limit ?? 2000, 1), 5000);
    return { files: out.slice(0, limit), total: out.length };
  }

  private readFile(args: { path: string }) {
    const { absPath, relPath } = resolveInRepo(this.opts, args.path);

    const st = fs.statSync(absPath);
    if (!st.isFile()) throw new Error(`Not a file: ${relPath}`);

    if (st.size > this.opts.maxReadBytes) {
      throw new Error(
        `File too large for read_file (${st.size} bytes > ${this.opts.maxReadBytes}): ${relPath}`
      );
    }

    const content = fs.readFileSync(absPath, "utf8");
    this.readFilesThisRun.add(relPath);
    return { path: relPath, bytes: st.size, content };
  }

  private readFilesBatch(args: { paths: string[] }) {
    const paths = Array.isArray(args.paths) ? args.paths : [];
    if (paths.length === 0) throw new Error("paths is required and must be a non-empty array");
    if (paths.length > 50) throw new Error(`Too many paths for read_files_batch (${paths.length} > 50)`);

    const out: Array<{ path: string; bytes: number; content: string | null; note?: string }> = [];
    for (const p of paths) {
      try {
        const { absPath, relPath } = resolveInRepo(this.opts, p);
        let st: fs.Stats;
        try {
          st = fs.statSync(absPath);
        } catch {
          out.push({ path: relPath, bytes: 0, content: null, note: "not_found" });
          continue;
        }
        if (!st.isFile()) {
          out.push({ path: relPath, bytes: st.size ?? 0, content: null, note: "not_file" });
          continue;
        }
        if (st.size > this.opts.maxReadBytes) {
          out.push({ path: relPath, bytes: st.size, content: null, note: "too_large" });
          continue;
        }
        const content = fs.readFileSync(absPath, "utf8");
        this.readFilesThisRun.add(relPath);
        out.push({ path: relPath, bytes: st.size, content });
      } catch (e: any) {
        const msg = (e?.message ?? "error").toString();
        out.push({ path: String(p), bytes: 0, content: null, note: msg });
      }
    }
    return out;
  }

  private writeFile(args: { path: string; content: string }) {
    const { absPath, relPath } = resolveInRepo(this.opts, args.path);

    const content = args.content ?? "";
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > this.opts.maxWriteBytes) {
      throw new Error(
        `Content too large for write_file (${bytes} bytes > ${this.opts.maxWriteBytes}): ${relPath}`
      );
    }

    // Enforce read_file before write for existing files
    const exists = fs.existsSync(absPath);
    if (exists && !this.readFilesThisRun.has(relPath)) {
      throw new Error(`MUST read_file before write_file for existing file: ${relPath}`);
    }

    ensureParentDirExists(absPath);
    fs.writeFileSync(absPath, content, "utf8");
    return { path: relPath, bytes };
  }

  private deleteFile(args: { path: string }) {
    const { absPath, relPath } = resolveInRepo(this.opts, args.path);

    if (!fs.existsSync(absPath)) {
      return { path: relPath, deleted: false, reason: "not_found" as const };
    }
    const st = fs.statSync(absPath);
    if (!st.isFile()) throw new Error(`Not a file: ${relPath}`);

    // Enforce read_file before delete for existing files
    if (!this.readFilesThisRun.has(relPath)) {
      throw new Error("MUST read_file before delete_file");
    }

    fs.unlinkSync(absPath);
    return { path: relPath, deleted: true };
  }

  private statFilesBatch(args: { paths: string[] }) {
    const paths = Array.isArray(args.paths) ? args.paths : [];
    if (paths.length === 0) throw new Error("paths is required and must be a non-empty array");
    if (paths.length > 200) throw new Error(`Too many paths for stat_files_batch (${paths.length} > 200)`);

    const out: Array<{ path: string; exists: boolean; is_file: boolean; bytes: number }> = [];
    for (const p of paths) {
      try {
        const { absPath, relPath } = resolveInRepo(this.opts, p);
        try {
          const st = fs.statSync(absPath);
          out.push({ path: relPath, exists: true, is_file: st.isFile(), bytes: st.size });
        } catch {
          out.push({ path: relPath, exists: false, is_file: false, bytes: 0 });
        }
      } catch {
        out.push({ path: String(p), exists: false, is_file: false, bytes: 0 });
      }
    }
    return out;
  }

  private searchInFiles(args: {
    query: string;
    prefix?: string;
    limit_files?: number;
    limit_matches?: number;
  }) {
    const query = (args.query ?? "").toString();
    if (!query) throw new Error("query is required");

    const prefix = (args.prefix ?? "").trim();
    const limitFiles = Math.min(Math.max(args.limit_files ?? 800, 1), 2000);
    const limitMatches = Math.min(Math.max(args.limit_matches ?? 200, 1), 2000);

    const all = listFilesRecursive(this.opts, 5000)
      .filter((p) => (prefix ? p.startsWith(prefix) : true))
      .slice(0, limitFiles);

    const matches: Array<{ path: string; line: number; text: string }> = [];

    for (const rel of all) {
      if (matches.length >= limitMatches) break;

      // Resolve safely within the repo (guards against symlink escape)
      let absPath: string;
      let relPath: string;
      try {
        const r = resolveInRepo(this.opts, rel);
        absPath = r.absPath;
        relPath = r.relPath;
      } catch {
        // Skip files that cannot be safely resolved
        continue;
      }

      let st: fs.Stats;
      try {
        st = fs.statSync(absPath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > this.opts.maxReadBytes) continue;

      const content = fs.readFileSync(absPath, "utf8");
      if (!content.includes(query)) continue;

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= limitMatches) break;
        if (lines[i].includes(query)) {
          matches.push({ path: relPath, line: i + 1, text: lines[i].slice(0, 400) });
        }
      }
    }

    return { query, matches, scanned_files: all.length };
  }

  private getBaselinePath(): string {
    const anyOpts: any = this.opts as any;
    const cfgPath: string | undefined = anyOpts.baselinePath;
    if (!cfgPath) {
      throw new Error("Baseline snapshot not found. It should be created automatically at agent start.");
    }

    const repoAbs = fs.realpathSync(path.resolve(this.opts.repoRoot));
    const candidateAbs = path.resolve(cfgPath);

    let realCandidateAbs: string;
    try {
      realCandidateAbs = fs.realpathSync(candidateAbs);
    } catch {
      const parent = path.dirname(candidateAbs);
      let realParent: string;
      try {
        realParent = fs.realpathSync(parent);
      } catch {
        throw new Error("Baseline snapshot not found. It should be created automatically at agent start.");
      }
      realCandidateAbs = path.join(realParent, path.basename(candidateAbs));
    }

    // Must NOT be inside the repo
    const mustNotStart = repoAbs + path.sep;
    if (realCandidateAbs.startsWith(mustNotStart)) {
      throw new Error("Invalid baseline location: must not be inside the repository.");
    }

    // Must be inside cache dir under os.tmpdir()/coding-agent-baselines
    const tmpRoot = fs.realpathSync(os.tmpdir());
    const cacheRoot = path.join(tmpRoot, "coding-agent-baselines") + path.sep;
    if (!realCandidateAbs.startsWith(cacheRoot)) {
      throw new Error("Invalid baseline location: must be inside the agent cache directory.");
    }

    return candidateAbs;
  }

  private loadBaseline(): {
    createdAt: string;
    maxReadBytes: number;
    files: Record<string, { bytes: number; content: string | null }>;
  } {
    const p = this.getBaselinePath();
    if (!fs.existsSync(p)) {
      throw new Error("Baseline snapshot not found. It should be created automatically at agent start.");
    }
    const raw = fs.readFileSync(p, "utf8");
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error("Invalid baseline file JSON.");
    }
    if (!json || typeof json !== "object" || !json.files) {
      throw new Error("Invalid baseline format.");
    }
    return json;
  }

  private getBaselineInfo() {
    const b = this.loadBaseline();
    const count = Object.keys(b.files).length;
    return { created_at: b.createdAt, files: count, maxReadBytes: b.maxReadBytes };
  }

  private listChangedFiles(args: { prefix?: string; limit?: number }) {
    const b = this.loadBaseline();
    const baselineFiles = Object.keys(b.files);
    const currentFiles = listFilesRecursive(this.opts, 5000);

    const prefix = (args.prefix ?? "").trim();
    const filt = (p: string) => (prefix ? p.startsWith(prefix) : true);

    const baselineSet = new Set(baselineFiles);
    const currentSet = new Set(currentFiles);

    const added = currentFiles.filter((p) => !baselineSet.has(p) && filt(p));
    const deleted = baselineFiles.filter((p) => !currentSet.has(p) && filt(p));

    const modified: string[] = [];
    for (const p of currentFiles) {
      if (!baselineSet.has(p)) continue;
      if (!filt(p)) continue;
      const abs = path.resolve(this.opts.repoRoot, p.replaceAll("/", path.sep));
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      const base = b.files[p];
      if (!base) continue;
      if (st.size !== base.bytes) {
        modified.push(p);
      } else if (base.content != null && st.size <= this.opts.maxReadBytes) {
        try {
          const currentContent = fs.readFileSync(abs, "utf8");
          if (currentContent !== base.content) modified.push(p);
        } catch {}
      }
    }

    const limit = Math.min(Math.max(args.limit ?? 2000, 1), 5000);
    return {
      baseline_files: baselineFiles.length,
      current_files: currentFiles.length,
      added: added.slice(0, limit),
      deleted: deleted.slice(0, limit),
      modified: modified.slice(0, limit),
    };
  }

  private readFileOriginal(args: { path: string }) {
    const { relPath } = resolveInRepo(this.opts, args.path);
    const b = this.loadBaseline();
    const base = b.files[relPath];
    if (!base) {
      return { path: relPath, existed: false };
    }
    return { path: relPath, existed: true, bytes: base.bytes, content: base.content };
  }

  private diffFileAgainstOriginal(args: { path: string; max_lines?: number }) {
    const { absPath, relPath } = resolveInRepo(this.opts, args.path);
    const b = this.loadBaseline();
    const base = b.files[relPath];

    let currentExists = fs.existsSync(absPath) && fs.statSync(absPath).isFile();

    if (!base && !currentExists) {
      return {
        path: relPath,
        status: "unchanged",
        summary: { before_bytes: 0, after_bytes: 0, added_lines: 0, removed_lines: 0 },
        note: "File did not exist in baseline and still does not exist.",
      };
    }

    const maxLines = Math.min(Math.max(args.max_lines ?? 2000, 1), 10000);

    if (!base && currentExists) {
      const content = this.safeRead(absPath, this.opts.maxReadBytes);
      const lines = content.split(/\r?\n/);
      const diff = this.buildUnifiedDiff(relPath, [], lines, maxLines);
      return {
        path: relPath,
        status: "added",
        summary: { before_bytes: 0, after_bytes: Buffer.byteLength(content, "utf8"), added_lines: lines.length, removed_lines: 0 },
        diff_text: diff,
      };
    }

    if (base && !currentExists) {
      const baseLines = (base.content ?? "").split(/\r?\n/);
      const diff = this.buildUnifiedDiff(relPath, baseLines, [], maxLines);
      return {
        path: relPath,
        status: "deleted",
        summary: { before_bytes: base.bytes, after_bytes: 0, added_lines: 0, removed_lines: baseLines.length },
        diff_text: diff,
      };
    }

    // both exist
    const baseContent = base!.content;
    if (baseContent == null) {
      const st = fs.statSync(absPath);
      const changed = st.size !== base!.bytes;
      return {
        path: relPath,
        status: changed ? "modified" : "unchanged",
        summary: { before_bytes: base!.bytes, after_bytes: st.size, added_lines: 0, removed_lines: 0 },
        note: "Original file too large for content diff; compared by size only.",
      };
    }

    // We have baseline content; decide whether to run LCS or fallback
    const curStat = fs.statSync(absPath);
    const afterBytes = curStat.size;
    const canReadCurrent = afterBytes <= this.opts.maxReadBytes;

    if (!canReadCurrent) {
      // Fallback: compare by size only, and include hash for baseline
      const beforeBytes = Buffer.byteLength(baseContent, "utf8");
      const baseHash = crypto.createHash("sha256").update(baseContent, "utf8").digest("hex");
      const status = beforeBytes === afterBytes ? "unchanged" : "modified";
      const header = [`--- a/${relPath}`, `+++ b/${relPath}`, `@@ DIFF OMITTED: file too large for content read @@`].join("\n");
      return {
        path: relPath,
        status,
        summary: { before_bytes: beforeBytes, after_bytes: afterBytes, added_lines: 0, removed_lines: 0 },
        note: `Diff omitted due to size limit. before_bytes=${beforeBytes}, after_bytes=${afterBytes}, before_sha256=${baseHash}, after_sha256=unavailable` ,
        diff_text: header,
      };
    }

    const currentContent = fs.readFileSync(absPath, "utf8");
    const baseLines = baseContent.split(/\r?\n/);
    const curLines = currentContent.split(/\r?\n/);

    if (baseLines.length + curLines.length > LCS_MAX_TOTAL_LINES) {
      // Fallback: fast compare using sizes and hashes
      const beforeBytes = Buffer.byteLength(baseContent, "utf8");
      const afterBytes2 = Buffer.byteLength(currentContent, "utf8");
      const baseHash = crypto.createHash("sha256").update(baseContent, "utf8").digest("hex");
      const curHash = crypto.createHash("sha256").update(currentContent, "utf8").digest("hex");
      const modified = beforeBytes !== afterBytes2 || baseHash !== curHash;
      const header = [`--- a/${relPath}`, `+++ b/${relPath}`, `@@ DIFF OMITTED: total line limit exceeded (${baseLines.length + curLines.length} > ${LCS_MAX_TOTAL_LINES}) @@`].join("\n");
      return {
        path: relPath,
        status: modified ? "modified" : "unchanged",
        summary: { before_bytes: beforeBytes, after_bytes: afterBytes2, added_lines: 0, removed_lines: 0 },
        note: `Diff omitted due to line limit. before_bytes=${beforeBytes}, after_bytes=${afterBytes2}, before_sha256=${baseHash}, after_sha256=${curHash}`,
        diff_text: header,
      };
    }

    const ops = this.diffLines(baseLines, curLines);
    let added = 0;
    let removed = 0;
    for (const op of ops) {
      if (op.type === "add") added += op.lines.length;
      if (op.type === "remove") removed += op.lines.length;
    }
    const diff = this.buildUnifiedDiff(relPath, baseLines, curLines, maxLines, ops);

    return {
      path: relPath,
      status: added === 0 && removed === 0 ? "unchanged" : "modified",
      summary: {
        before_bytes: Buffer.byteLength(baseContent, "utf8"),
        after_bytes: Buffer.byteLength(currentContent, "utf8"),
        added_lines: added,
        removed_lines: removed,
      },
      diff_text: diff,
    };
  }

  private diffFileAgainstCurrent(args: { path: string; proposed_content: string; max_lines?: number }) {
    const { absPath, relPath } = resolveInRepo(this.opts, args.path);

    const exists = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
    const currentContent = exists ? this.safeRead(absPath, this.opts.maxReadBytes) : "";
    const proposed = (args.proposed_content ?? "").toString();

    const maxLines = Math.min(Math.max(args.max_lines ?? 2000, 1), 10000);

    const curLines = currentContent.split(/\r?\n/);
    const propLines = proposed.split(/\r?\n/);

    if (curLines.length + propLines.length > LCS_MAX_TOTAL_LINES) {
      const header = [
        `--- a/${relPath}`,
        `+++ b/${relPath}`,
        `@@ DIFF OMITTED: total line limit exceeded (${curLines.length + propLines.length} > ${LCS_MAX_TOTAL_LINES}) @@`,
      ].join("\n");
      return { path: relPath, diff_text: header };
    }

    const ops = this.diffLines(curLines, propLines);
    const diff = this.buildUnifiedDiff(relPath, curLines, propLines, maxLines, ops);
    return { path: relPath, diff_text: diff };
  }

  private safeRead(absPath: string, limit: number): string {
    const st = fs.statSync(absPath);
    if (st.size > limit) {
      throw new Error(`File too large for diff (${st.size} bytes > ${limit}): ${absPath}`);
    }
    return fs.readFileSync(absPath, "utf8");
  }

  // Prosty LCS diff linii
  private diffLines(a: string[], b: string[]): Array<{ type: "equal" | "add" | "remove"; lines: string[] }> {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops: Array<{ type: "equal" | "add" | "remove"; lines: string[] }> = [];
    let i = 0,
      j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) {
        this.pushOp(ops, "equal", a[i]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        this.pushOp(ops, "remove", a[i]);
        i++;
      } else {
        this.pushOp(ops, "add", b[j]);
        j++;
      }
    }
    while (i < m) {
      this.pushOp(ops, "remove", a[i++]);
    }
    while (j < n) {
      this.pushOp(ops, "add", b[j++]);
    }
    return ops;
  }

  private pushOp(
    ops: Array<{ type: "equal" | "add" | "remove"; lines: string[] }>,
    type: "equal" | "add" | "remove",
    line: string
  ) {
    const last = ops[ops.length - 1];
    if (last && last.type === type) {
      last.lines.push(line);
    } else {
      ops.push({ type, lines: [line] });
    }
  }

  private buildUnifiedDiff(
    relPath: string,
    a: string[],
    b: string[],
    maxLines: number,
    precomputedOps?: Array<{ type: "equal" | "add" | "remove"; lines: string[] }>
  ): string {
    const ops = precomputedOps ?? this.diffLines(a, b);
    const header = [`--- a/${relPath}`, `+++ b/${relPath}`];
    const body: string[] = [];
    for (const op of ops) {
      for (const line of op.lines) {
        if (body.length >= maxLines) break;
        if (op.type === "equal") body.push(" " + line);
        else if (op.type === "add") body.push("+" + line);
        else body.push("-" + line);
      }
      if (body.length >= maxLines) break;
    }
    return header.concat(body).join("\n");
  }

  private applyPatch(args: { patch: string }) {
    const patch = (args.patch ?? "").toString();
    if (!patch.trim()) throw new Error("patch is required");

    type FilePatch = { relPath: string; lines: string[] };
    const sections: FilePatch[] = [];
    const lines = patch.replace(/\r\n/g, "\n").split("\n");

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line?.startsWith("--- a/")) {
        const next = lines[i + 1] ?? "";
        if (!next.startsWith("+++ b/")) {
          throw new Error("Invalid patch format: expected '+++ b/...' after '--- a/...'");
        }
        const pathA = line.slice(6).trim(); // after '--- a/'
        const pathB = next.slice(6).trim(); // after '+++ b/'
        if (!pathA || !pathB) throw new Error("Invalid patch headers: empty path");
        // Use B path as target
        const targetRel = pathB;
        i += 2;
        const body: string[] = [];
        while (i < lines.length && !lines[i].startsWith("--- a/")) {
          const bLine = lines[i];
          if (bLine.startsWith(" ") || bLine.startsWith("+") || bLine.startsWith("-")) {
            body.push(bLine);
          } else {
            throw new Error("Invalid patch line");
          }
          i++;
        }
        sections.push({ relPath: targetRel, lines: body });
      } else {
        i++;
      }
    }

    if (sections.length === 0) {
      throw new Error("No file sections found in patch");
    }

    // First pass: validate and compute new contents without writing
    const plannedWrites: Array<{
      relPath: string;
      absPath: string;
      existedBefore: boolean;
      beforeBytes: number;
      afterBytes: number;
      newContent: string;
    }> = [];

    for (const sec of sections) {
      const { absPath, relPath } = resolveInRepo(this.opts, sec.relPath);

      const exists = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
      const beforeContent = exists ? fs.readFileSync(absPath, "utf8") : "";
      const beforeLines = beforeContent.split(/\r?\n/);

      // Build base and after from patch body
      const baseFromPatch: string[] = [];
      const afterFromPatch: string[] = [];
      for (const l of sec.lines) {
        if (l.startsWith(" ")) {
          const t = l.slice(1);
          baseFromPatch.push(t);
          afterFromPatch.push(t);
        } else if (l.startsWith("-")) {
          baseFromPatch.push(l.slice(1));
        } else if (l.startsWith("+")) {
          afterFromPatch.push(l.slice(1));
        }
      }

      let newContent: string;
      if (exists) {
        if (!this.readFilesThisRun.has(relPath)) {
          throw new Error(`MUST read_file before apply_patch for existing file: ${relPath}`);
        }
        const baseStr = baseFromPatch.join("\n");
        const curStr = beforeLines.join("\n");
        if (curStr === baseStr) {
          // Whole-file replacement (legacy behavior)
          newContent = afterFromPatch.join("\n");
        } else {
          // Contextual mode: treat baseFromPatch as a fragment to replace.
          const baseBlock = baseStr + "\n";
          const afterBlock = afterFromPatch.join("\n") + "\n";
          let count = 0;
          let idx = 0;
          while (true) {
            const found = beforeContent.indexOf(baseBlock, idx);
            if (found === -1) break;
            count++;
            idx = found + baseBlock.length;
          }
          if (count !== 1) {
            throw new Error(
              `Contextual patch failed for ${relPath}: expected exactly one occurrence of base block, found ${count}.`
            );
          }
          newContent = beforeContent.replace(baseBlock, afterBlock);
        }
      } else {
        // For new files, base must be empty
        if (baseFromPatch.length > 0 && baseFromPatch.join("\n").trim() !== "") {
          throw new Error(
            `Patch for ${relPath} implies non-empty base, but file does not exist. Create file with write_file or provide correct patch.`
          );
        }
        newContent = afterFromPatch.join("\n");
      }

      const afterBytes = Buffer.byteLength(newContent, "utf8");
      if (afterBytes > this.opts.maxWriteBytes) {
        throw new Error(
          `Resulting content too large for apply_patch (${afterBytes} bytes > ${this.opts.maxWriteBytes}): ${relPath}`
        );
      }

      plannedWrites.push({
        relPath,
        absPath,
        existedBefore: exists,
        beforeBytes: Buffer.byteLength(beforeContent, "utf8"),
        afterBytes,
        newContent,
      });
    }

    // Second pass: perform writes
    for (const w of plannedWrites) {
      ensureParentDirExists(w.absPath);
      fs.writeFileSync(w.absPath, w.newContent, "utf8");
    }

    return {
      files: plannedWrites.map((w) => ({
        path: w.relPath,
        existed_before: w.existedBefore,
        before_bytes: w.beforeBytes,
        after_bytes: w.afterBytes,
        status: w.existedBefore ? (w.beforeBytes === w.afterBytes ? "unchanged" : "modified") : "created",
      })),
    };
  }
}
