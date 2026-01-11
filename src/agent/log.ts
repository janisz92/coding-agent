import fs from "node:fs";
import path from "node:path";

function redactString(input: string): string {
  if (!input) return input;
  let s = input;
  // Mask key=value and key: value patterns for common secret keys
  const keyPattern = /(api_key|apikey|token|secret|password|client_secret|private_key)\s*([:=])\s*([^\s,;"']+)/gi;
  s = s.replace(keyPattern, (_m, k: string, sep: string) => `${k}${sep} ****`);
  // Mask Authorization: Bearer xxx and Bearer xxx
  s = s.replace(/authorization\s*:\s*bearer\s+[^\s]+/gi, "Authorization: Bearer ****");
  s = s.replace(/bearer\s+[^\s]+/gi, "Bearer ****");
  return s;
}

function redactValue(val: any): any {
  if (typeof val === "string") return redactString(val);
  if (Array.isArray(val)) return val.map((v) => redactValue(v));
  if (val && typeof val === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) out[k] = redactValue(v);
    return out;
  }
  return val;
}

export class AgentLogger {
  private readonly rawPath: string;

  constructor(private readonly repoRoot: string) {
    // Ensure repo root exists for logs/outputs
    try {
      fs.mkdirSync(repoRoot, { recursive: true });
    } catch (e: any) {
      console.error(
        "[agent] ERROR: Nie można utworzyć katalogu repoRoot:",
        repoRoot,
        "\nPowód:",
        e?.message ?? String(e)
      );
      process.exitCode = 1;
      // Twarde zakończenie aby uniknąć kolejnych błędów zapisu logów/plików wyjściowych
      process.exit(1);
    }
    this.rawPath = path.join(repoRoot, "agent.raw.txt");
  }

  initNewRun(meta: { task: string; model: string; startedAt: string }) {
    this.appendLine("=== AGENT RUN START ===");
    this.appendJSON({ type: "meta", ...meta });
  }

  appendLine(line: string) {
    const safe = redactString(line ?? "");
    fs.appendFileSync(this.rawPath, safe + "\n", "utf8");
  }

  appendJSON(obj: any) {
    const redacted = redactValue(obj);
    const line = JSON.stringify(redacted);
    fs.appendFileSync(this.rawPath, line + "\n", "utf8");
  }

  saveDiffText(diffText: string) {
    const outPath = path.join(this.repoRoot, "agent.diff.txt");
    fs.writeFileSync(outPath, diffText, "utf8");
    return outPath;
  }
}
