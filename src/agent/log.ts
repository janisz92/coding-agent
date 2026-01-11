import fs from "node:fs";
import path from "node:path";

export class AgentLogger {
  private readonly rawPath: string;

  constructor(private readonly repoRoot: string) {
    this.rawPath = path.join(repoRoot, "agent.raw.txt");
  }

  initNewRun(meta: { task: string; model: string; startedAt: string }) {
    this.appendLine("=== AGENT RUN START ===");
    this.appendJSON({ type: "meta", ...meta });
  }

  appendLine(line: string) {
    fs.appendFileSync(this.rawPath, line + "\n", "utf8");
  }

  appendJSON(obj: any) {
    const line = JSON.stringify(obj);
    fs.appendFileSync(this.rawPath, line + "\n", "utf8");
  }

  saveDiffText(diffText: string) {
    const outPath = path.join(this.repoRoot, "agent.diff.txt");
    fs.writeFileSync(outPath, diffText, "utf8");
    return outPath;
  }
}
