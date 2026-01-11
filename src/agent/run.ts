import path from "node:path";
import { spawnSync } from "node:child_process";

import { openai } from "../openai.ts";
import { AgentLogger } from "./log.ts";
import { RepoTools } from "./tools.ts";
import { SandboxOptions } from "./security.ts";

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

type AgentRunOptions = {
  repoRoot: string;
  task: string;
  model?: string; // np. "gpt-5"
  maxToolCalls?: number; // domyślnie 50
};

function nowIso() {
  return new Date().toISOString();
}

function safeGitDiff(repoRoot: string): { ok: boolean; diff?: string; error?: string } {
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

function buildSystemPrompt() {
  return [
    "Jesteś agentem do edycji repozytorium poprzez narzędzia (tool calling).",
    "",
    "ZASADY:",
    "- Zawsze używaj read_file zanim zmodyfikujesz plik.",
    "- Minimalizuj zmiany (unikaj masowego reformatowania).",
    "- Przy write_file podawaj pełną nową zawartość pliku.",
    "- NIE wykonuj poleceń systemowych. Do dyspozycji masz tylko narzędzia.",
    "- Pracujesz wyłącznie w obrębie repo wskazanego przez --repo; path traversal jest zabroniony.",
    "- Nie czytaj ani nie zapisuj denylistowanych ścieżek (.git/, node_modules/, dist/, .env, *.pem, *.key).",
    "- Jeśli potrzebujesz znaleźć coś w kodzie, użyj search_in_files albo list_files + read_file.",
    "",
    "CEL: zrealizuj zadanie użytkownika poprzez serię wywołań narzędzi.",
  ].join("\n");
}

/**
 * Agent loop z tool calling.
 * Stabilny wariant: kolejne iteracje przez previous_response_id + odsyłanie function_call + function_call_output.
 */
export async function runAgent(opts: AgentRunOptions): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot);
  const task = opts.task.trim();
  const model = opts.model ?? "gpt-5";
  const maxToolCalls = Math.max(1, Math.min(opts.maxToolCalls ?? 50, 50));

  const logger = new AgentLogger(repoRoot);
  logger.initNewRun({ task, model, startedAt: nowIso() });

  const tools = new RepoTools(defaultSandboxOptions(repoRoot));

  // Pierwsze wywołanie: system + user
  logger.appendJSON({ type: "model_request", at: nowIso(), model, phase: "initial" });

  let response = await openai.responses.create({
    model,
    tools: tools.getToolSpecs() as any,
    input: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: task },
    ],
  });

  let toolCallsUsed = 0;

  while (true) {
    logger.appendJSON({
      type: "model_response",
      at: nowIso(),
      id: (response as any).id,
      output_text: (response as any).output_text ?? "",
      output: (response as any).output ?? [],
    });

    const outputItems: any[] = (response as any).output ?? [];
    const functionCalls = outputItems.filter((it) => it?.type === "function_call");

    // Jeśli model nie woła narzędzi, kończymy
    if (functionCalls.length === 0) break;

    const nextInput: any[] = [];

    // Dla stabilności: odsyłamy także items function_call (i ewentualne reasoning),
    // a zaraz po nich function_call_output.
    for (const item of outputItems) {
      if (item?.type === "reasoning") {
        nextInput.push(item);
      }

      if (item?.type === "function_call") {
        toolCallsUsed++;
        if (toolCallsUsed > maxToolCalls) {
          throw new Error(`Tool call limit exceeded (${maxToolCalls}).`);
        }

        // 1) odeślij function_call
        nextInput.push(item);

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

        // 2) odeślij output
        nextInput.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result),
        });
      }
    }

    logger.appendJSON({
      type: "model_request",
      at: nowIso(),
      model,
      phase: "followup",
      tool_calls_used: toolCallsUsed,
      followup_items: nextInput.length,
    });

    // Kolejna iteracja: previous_response_id + “delta input”
    response = await openai.responses.create({
      model,
      tools: tools.getToolSpecs() as any,
      previous_response_id: (response as any).id,
      input: nextInput,
    });
  }

  // Po zakończeniu: lokalny git diff (bez modelu)
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
