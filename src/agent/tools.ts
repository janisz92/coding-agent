import fs from "node:fs";
import path from "node:path";
import {
  SandboxOptions,
  listFilesRecursive,
  resolveInRepo,
  ensureParentDirExists,
} from "./security.ts";

export type ToolName =
  | "list_files"
  | "read_file"
  | "write_file"
  | "delete_file"
  | "search_in_files";

export type ToolCall = {
  name: ToolName;
  arguments: any;
};

export type ToolResult = {
  ok: boolean;
  result?: any;
  error?: string;
};

export class RepoTools {
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
    ] as const;
  }

  async dispatch(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case "list_files":
          return { ok: true, result: this.listFiles(call.arguments) };
        case "read_file":
          return { ok: true, result: this.readFile(call.arguments) };
        case "write_file":
          return { ok: true, result: this.writeFile(call.arguments) };
        case "delete_file":
          return { ok: true, result: this.deleteFile(call.arguments) };
        case "search_in_files":
          return { ok: true, result: this.searchInFiles(call.arguments) };
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
    return { path: relPath, bytes: st.size, content };
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

    fs.unlinkSync(absPath);
    return { path: relPath, deleted: true };
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

      const abs = path.resolve(this.opts.repoRoot, rel.replaceAll("/", path.sep));
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > this.opts.maxReadBytes) continue;

      const content = fs.readFileSync(abs, "utf8");
      if (!content.includes(query)) continue;

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= limitMatches) break;
        if (lines[i].includes(query)) {
          matches.push({ path: rel, line: i + 1, text: lines[i].slice(0, 400) });
        }
      }
    }

    return { query, matches, scanned_files: all.length };
  }
}
