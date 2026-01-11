import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { AgentLogger } from "../src/agent/log.ts";

function tmpDir(prefix = "agent-log-rot-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const ONE_MB = 1024 * 1024;

// Syntetyczny test rotacji logów: zapisujemy >20MB aby wywołać rotację
// Rozmiar progu: 20MB (twardo w kodzie)

test("AgentLogger: rotacja po przekroczeniu 20MB i maks 3 pliki rotacji", () => {
  const dir = tmpDir();
  const logger = new AgentLogger(dir);

  const bigLine = "x".repeat(ONE_MB);

  // Zapisz ~21MB, aby przekroczyć próg i wywołać rotację
  for (let i = 0; i < 21; i++) logger.appendLine(bigLine);

  const base = path.join(dir, "agent.raw.txt");
  const r1 = path.join(dir, "agent.raw.1.txt");
  const r2 = path.join(dir, "agent.raw.2.txt");
  const r3 = path.join(dir, "agent.raw.3.txt");
  const r4 = path.join(dir, "agent.raw.4.txt");

  assert.ok(fs.existsSync(base), "agent.raw.txt powinien istnieć");
  assert.ok(fs.existsSync(r1), "agent.raw.1.txt powinien istnieć po pierwszej rotacji");
  const r1st = fs.statSync(r1);
  assert.ok(r1st.size > 0, "rotowany plik nie powinien być pusty");

  // Wymuś kolejne rotacje (łącznie do 3 plików rotowanych)
  for (let rot = 0; rot < 3; rot++) {
    for (let i = 0; i < 21; i++) logger.appendLine(bigLine);
  }

  assert.ok(fs.existsSync(r1), "r1 powinien istnieć");
  assert.ok(fs.existsSync(r2), "r2 powinien istnieć");
  assert.ok(fs.existsSync(r3), "r3 powinien istnieć");
  assert.equal(fs.existsSync(r4), false, "r4 nie powinien istnieć (max 3 rotacje)");
});
