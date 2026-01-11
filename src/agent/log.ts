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
  private readonly maxBytes: number = 20 * 1024 * 1024; // 20MB

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
    this.ensureRotation();
    const safe = redactString(line ?? "");
    fs.appendFileSync(this.rawPath, safe + "\n", "utf8");
    this.ensureRotation();
  }

  appendJSON(obj: any) {
    this.ensureRotation();
    const redacted = redactValue(obj);
    const line = JSON.stringify(redacted);
    fs.appendFileSync(this.rawPath, line + "\n", "utf8");
    this.ensureRotation();
  }

  saveDiffText(diffText: string) {
    const outPath = path.join(this.repoRoot, "agent.diff.txt");
    fs.writeFileSync(outPath, diffText, "utf8");
    return outPath;
  }

  private ensureRotation() {
    try {
      const st = fs.existsSync(this.rawPath) ? fs.statSync(this.rawPath) : null;
      if (st && st.isFile() && st.size > this.maxBytes) {
        this.rotateLogs();
      }
    } catch {
      // ignoruj błędy stat/rotacji, logowanie nie powinno przerywać działania agenta
    }
  }

  private rotateLogs() {
    const base = this.rawPath; // .../agent.raw.txt
    const r1 = base.replace(/\.txt$/, ".1.txt");
    const r2 = base.replace(/\.txt$/, ".2.txt");
    const r3 = base.replace(/\.txt$/, ".3.txt");

    try {
      // Usuń najstarszy jeśli istnieje (>3 rotacje nie trzymamy)
      if (fs.existsSync(r3)) fs.rmSync(r3, { force: true });
      // Przesuń 2 -> 3, 1 -> 2, raw -> 1
      if (fs.existsSync(r2)) fs.renameSync(r2, r3);
      if (fs.existsSync(r1)) fs.renameSync(r1, r2);
      if (fs.existsSync(base)) fs.renameSync(base, r1);
      // Utwórz pusty nowy plik bazowy
      fs.writeFileSync(base, "", "utf8");
    } catch {
      // Pomijamy błędy rotacji
    }
  }
}
