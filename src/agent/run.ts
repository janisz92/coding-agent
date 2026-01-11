import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import { openai } from "../openai.ts";
import { AgentLogger } from "./log.ts";
import { RepoTools } from "./tools.ts";
import { SandboxOptions, listFilesRecursive } from "./security.ts";

/**
 * Konfiguracja bezpieczeństwa repo sandbox.
 */
export function defaultSandboxOptions(repoRoot: string): SandboxOptions {
  return {
    repoRoot,
    denyDirs: [".git", "node_modules", "dist"],
    denyFilesExact: [".env"],
    denyExtensions: [".pem", ".key"],
    maxReadBytes: 400_000,
    maxWriteBytes: 800_000,
  };
}

export type AgentRunOptions = {
  repoRoot: string;
  task: string;
  model?: string; // np. "gpt-5"
  maxToolCalls?: number; // domyślnie 50
  debug?: boolean; // rozszerzone logi
};

function nowIso() {
  return new Date().toISOString();
}

function safeGitDiff(repoRoot: string): { ok: boolean; diff?: string; error?: string } {
  // Jedyna komenda systemowa jaką wykonujemy: git diff
  const res = spawnSync("git", ["diff"], {
    cwd: repoRoot,
    shell: false,
    encoding: "utf8",
  });

  if (res.status !== 0) {
    return { ok: false, error: `${res.stdout}\n${res.stderr}`.trim() };
  }
  return { ok: true, diff: res.stdout ?? "" };
}

function buildSystemPrompt(repoRoot: string) {
  // Zawsze wczytuj prompt z pliku: resources/prompts/codeAgentPromt.txt (relatywnie do repoRoot)
  const promptPath = path.join(repoRoot, "resources", "prompts", "codeAgentPromt.txt");
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Brak pliku promptu: ${promptPath}`);
  }
  const content = fs.readFileSync(promptPath, "utf8");
  const normalized = (content ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new Error(`Plik promptu jest pusty: ${promptPath}`);
  }
  return normalized;
}

/**
 * Tworzy snapshot bazowy repozytorium na potrzeby review.
 * Zapisuje baseline.json w katalogu cache systemowego: os.tmpdir()/coding-agent-baselines/<sha256(repoAbs)>/baseline.json.
 */
export function createBaseline(opts: SandboxOptions): { path: string; files: number } {
  const repoAbs = fs.realpathSync(path.resolve(opts.repoRoot));
  const hash = crypto.createHash("sha256").update(repoAbs, "utf8").digest("hex");
  const cacheDir = path.join(os.tmpdir(), "coding-agent-baselines", hash);
  const baselinePath = path.join(cacheDir, "baseline.json");

  fs.mkdirSync(cacheDir, { recursive: true });

  const files = listFilesRecursive(opts, 5000);
  const data: any = {
    createdAt: nowIso(),
    maxReadBytes: opts.maxReadBytes,
    files: {} as Record<string, { bytes: number; content: string | null }>,
  };

  for (const rel of files) {
    try {
      const abs = path.join(repoAbs, rel.replaceAll("/", path.sep));
      const st = fs.statSync(abs);
      if (!st.isFile()) continue;
      if (st.size <= opts.maxReadBytes) {
        const content = fs.readFileSync(abs, "utf8");
        data.files[rel] = { bytes: st.size, content };
      } else {
        data.files[rel] = { bytes: st.size, content: null };
      }
    } catch {
      // pomiń pliki, których nie da się odczytać
    }
  }

  fs.writeFileSync(baselinePath, JSON.stringify(data, null, 2), "utf8");
  return { path: baselinePath, files: Object.keys(data.files).length };
}

function summarizeOutputItems(items: any[]) {
  return items.map((it) => {
    const out: any = { type: it?.type };
    if (it?.type === "function_call") {
      out.name = it?.name;
      const arg = it?.arguments;
      const raw = typeof arg === "string" ? arg : JSON.stringify(arg ?? {});
      out.arguments_preview = (raw ?? "").slice(0, 200);
    } else if (it?.type === "message") {
      out.role = it?.role;
      const c = it?.content ?? "";
      out.content_preview = (typeof c === "string" ? c : JSON.stringify(c)).slice(0, 200);
    } else if (it) {
      out.preview = JSON.stringify(it).slice(0, 200);
    }
    return out;
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Agent loop z tool calling.
 *
 * WAŻNE:
 * - Używamy previous_response_id, więc NIE odsyłamy function_call itemów z powrotem w input,
 *   bo mają id (fc_...) i API zwraca 400 Duplicate item found.
 * - Odsyłamy tylko function_call_output z call_id.
 */
export async function runAgent(opts: AgentRunOptions): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot);
  const task = opts.task.trim();
  const model = opts.model ?? "gpt-5";
  const maxToolCalls = Math.max(1, Math.min(opts.maxToolCalls ?? 50, 50));
  const debug = !!opts.debug;

  const logger = new AgentLogger(repoRoot);
  logger.initNewRun({ task, model, startedAt: nowIso() });

  const sandbox = defaultSandboxOptions(repoRoot);

  // Utwórz snapshot bazowy dla funkcji review (poza repo)
  let baselinePath: string | undefined;
  try {
    const b = createBaseline(sandbox);
    baselinePath = b.path;
    logger.appendJSON({ type: "baseline_created", at: nowIso(), path: b.path, files: b.files });
  } catch (e: any) {
    logger.appendJSON({ type: "baseline_error", at: nowIso(), error: e?.message ?? String(e) });
  }

  const tools = new RepoTools({ ...(sandbox as any), baselinePath } as any);

  // Timeout + retry dla wywołań OpenAI
  const requestWithRetry = async (body: any, timeoutMs: number, phase: "initial" | "followup"): Promise<any> => {
    const maxAttempts = 3;
    let lastErr: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        // W Node SDK v4: signal idzie w 2. argumencie opcji, nie w body
        const res = await openai.responses.create(body as any, { signal: ctrl.signal } as any);
        return res;
      } catch (e: any) {
        lastErr = e;

        const status = (e && (e.status ?? e.response?.status)) as number | undefined;
        const code = e?.code as string | undefined;
        const name = e?.name as string | undefined;
        const msg = e?.message ? String(e.message) : "";

        const isAbort = name === "AbortError" || /aborted|abort/i.test(msg);
        const isRetriableStatus = typeof status === "number" && (status === 429 || status >= 500);

        const isRetriableNetwork =
          (code &&
            [
              "ECONNRESET",
              "ETIMEDOUT",
              "ENOTFOUND",
              "EAI_AGAIN",
              "ECONNREFUSED",
              "UND_ERR_CONNECT_TIMEOUT",
            ].includes(code)) ||
          /network|fetch failed|timeout/i.test(msg);

        const retriable = isAbort || isRetriableStatus || isRetriableNetwork;

        logger.appendJSON({
          type: "openai_request_error",
          at: nowIso(),
          phase,
          attempt,
          max_attempts: maxAttempts,
          timeout_ms: timeoutMs,
          status,
          code,
          name,
          message: msg.slice(0, 800),
          retriable,
        });

        if (attempt < maxAttempts && retriable) {
          const backoff = 250 * attempt;
          logger.appendJSON({
            type: "openai_request_retry",
            at: nowIso(),
            phase,
            next_attempt: attempt + 1,
            backoff_ms: backoff,
          });
          await sleep(backoff);
          continue;
        }

        throw e;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastErr;
  };

  logger.appendJSON({ type: "model_request", at: nowIso(), model, phase: "initial" });

  // Pierwsze wywołanie: system + user
  let response = await requestWithRetry(
    {
      model,
      tools: tools.getToolSpecs() as any,
      input: [
        { role: "system", content: buildSystemPrompt(repoRoot) },
        { role: "user", content: task },
      ],
    },
    180_000,
    "initial"
  );

  let toolCallsUsed = 0;

  while (true) {
    const outputItems: any[] = (response as any).output ?? [];

    if (debug) {
      logger.appendJSON({
        type: "model_response",
        at: nowIso(),
        id: (response as any).id,
        output_text: (response as any).output_text ?? "",
        output: outputItems,
      });
    } else {
      logger.appendJSON({
        type: "model_response",
        at: nowIso(),
        id: (response as any).id,
        output_text: (response as any).output_text ?? "",
        output_summary: summarizeOutputItems(outputItems),
      });
    }

    const functionCalls = outputItems.filter((it) => it?.type === "function_call");

    // Jeśli model nie woła narzędzi, kończymy
    if (functionCalls.length === 0) break;

    const nextInput: any[] = [];

    for (const item of functionCalls) {
      toolCallsUsed++;
      if (toolCallsUsed > maxToolCalls) {
        throw new Error(`Tool call limit exceeded (${maxToolCalls}).`);
      }

      const name = item.name as any;
      const callId = item.call_id;
      const argsRaw = item.arguments ?? "{}";

      logger.appendJSON({
        type: "tool_call",
        at: nowIso(),
        call_id: callId,
        name,
        arguments: argsRaw,
      });

      let args: any = {};
      try {
        args = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
      } catch {
        args = {};
      }

      const result = await tools.dispatch({ name, arguments: args } as any);

      logger.appendJSON({
        type: "tool_result",
        at: nowIso(),
        call_id: callId,
        name,
        ok: result.ok,
        error: result.error,
        result_preview:
          result.result && typeof result.result === "object"
            ? JSON.stringify(result.result).slice(0, 5000)
            : String(result.result ?? "").slice(0, 5000),
      });

      nextInput.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result),
      });
    }

    logger.appendJSON({
      type: "model_request",
      at: nowIso(),
      model,
      phase: "followup",
      tool_calls_used: toolCallsUsed,
      followup_items: nextInput.length,
    });

    response = await requestWithRetry(
      {
        model,
        tools: tools.getToolSpecs() as any,
        previous_response_id: (response as any).id,
        input: nextInput,
      },
      240_000,
      "followup"
    );
  }

  // Po zakończeniu agent loop: generujemy lokalnie agent.diff.txt (bez udziału modelu)
  const diffRes = safeGitDiff(repoRoot);
  if (diffRes.ok) {
    const out = logger.saveDiffText(diffRes.diff ?? "");
    logger.appendLine(`=== SAVED DIFF: ${out} ===`);
  } else {
    logger.appendLine("=== WARNING: git diff failed (repo may not be git). Diff omitted. ===");
    logger.appendJSON({ type: "git_diff_error", at: nowIso(), error: diffRes.error });
  }

  logger.appendLine("=== AGENT RUN END ===");
}
