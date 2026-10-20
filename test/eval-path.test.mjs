// normalize と保存の検査は評価の子プロセスを通る（0.3.0。print-craft の docs/authoring-try-plan.md 4.6、T0b。Codex r2 M5）:
// 子プロセスの入口（dist/server/eval-worker.cjs）を外した本体では、pcraft_normalize と pcraft_save_settings / pcraft_update_button が
// failed（EvalError）になり、保存しない（親のエンジンで評価する道が残っていない）。文に絶対パスを出さない
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { ROOT, SETTINGS_TEXT, SKIP as skip, connectClaudeCode, makeWorkspace, saveInput, sc } from "./helpers.mjs";

const noRunEval = typeof core.runEval !== "function" && "中核に runEval が無い（tools 2.3.0 から）";

test("子プロセスの入口を外した本体では normalize・保存・差し替えが failed（EvalError）で保存しない（親で評価する道が無い）", { skip: skip || noRunEval }, async () => {
  const copy = mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-noworker-"));
  cpSync(path.join(ROOT, "dist"), path.join(copy, "dist"), { recursive: true });
  rmSync(path.join(copy, "dist", "server", "eval-worker.cjs"));
  const root = makeWorkspace();
  const s = await connectClaudeCode([root], undefined, { server: path.join(copy, "dist", "server", "index.cjs") });
  try {
    const saved = sc(await s.call("pcraft_save_settings", saveInput(root, "settings/APP3740-見積書-見積書.json")));
    assert.deepEqual([saved.status, saved.error.code], ["failed", "EvalError"], JSON.stringify(saved));
    assert.equal(existsSync(path.join(root, "settings", "APP3740-見積書-見積書.json")), false, "保存しない");
    // 検査だけのツールも同じ（設定は手で置く）
    mkdirSync(path.join(root, "settings"), { recursive: true });
    writeFileSync(path.join(root, "settings", "x.json"), SETTINGS_TEXT);
    const n = sc(await s.call("pcraft_normalize", { workspaceId: root, path: "settings/x.json", fields: "fields/3740.json" }));
    assert.deepEqual([n.status, n.error.code], ["failed", "EvalError"], JSON.stringify(n));
    const b = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/x.json" }));
    const u = sc(await s.call("pcraft_update_button", { workspaceId: root, path: "settings/x.json", button: "見積書", expectedDigest: b.digest, replacement: JSON.stringify(JSON.parse(SETTINGS_TEXT).pluginInfos[0]), fields: "fields/3740.json" }));
    assert.deepEqual([u.status, u.error.code], ["failed", "EvalError"], JSON.stringify(u));
    assert.equal(readFileSync(path.join(root, "settings", "x.json"), "utf8"), SETTINGS_TEXT, "差し替えない");
    assert.ok(!s.output().includes(copy) && !s.output().includes(root), "応答とログに絶対パスを出さない");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(copy, { recursive: true, force: true });
  }
});
