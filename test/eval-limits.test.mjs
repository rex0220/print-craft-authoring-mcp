// 評価の上限（0.3.0。print-craft の docs/authoring-try-plan.md 4.6、T0d）: MCP を別のプロセスとして起こし、重い帳票の preview を
// 時間の上限（PCRAFT_EVAL_TIMEOUT_SEC）・メモリの上限（PCRAFT_EVAL_HEAP_MB）で止めた後も、同じサーバーが次の要求（pcraft_status、pcraft_normalize、pcraft_preview）に答える
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { ROOT, SETTINGS_TEXT, SKIP as skip, connectClaudeCode, makeWorkspace, sc } from "./helpers.mjs";

const ZIP9 = process.env.PCRAFT_TEST_PLUGIN_ZIP9 ?? path.resolve(ROOT, "../print-craft/dist/print-craft-plugin9.zip");
const noRunEval = typeof core.runEval !== "function" && "中核に runEval が無い（tools 2.3.0 から）";
const skip9 = skip || noRunEval || (!existsSync(ZIP9) && `Ver.9 の zip が無い: ${ZIP9}`);
const RECORD_TEXT = readFileSync(path.join(ROOT, "test", "fixtures", "record-3740-3.json"), "utf8");

function workspaceWith(formulaSet) {
  const root = makeWorkspace();
  const s = JSON.parse(SETTINGS_TEXT);
  s.pluginInfos[0].tagsInfo.fieldsInfo.find((f) => f.html !== undefined).formulaSet = formulaSet;
  mkdirSync(path.join(root, "settings"), { recursive: true });
  mkdirSync(path.join(root, "records"), { recursive: true });
  writeFileSync(path.join(root, "settings", "heavy.json"), JSON.stringify(s));
  writeFileSync(path.join(root, "settings", "ok.json"), SETTINGS_TEXT);
  writeFileSync(path.join(root, "records", "3740-3.json"), RECORD_TEXT);
  return root;
}
const preview = (s, root, file) => s.call("pcraft_preview", { workspaceId: root, path: file, record: "records/3740-3.json", fields: "fields/3740.json" });

async function stillAnswers(s, root) {
  const st = sc(await s.call("pcraft_status", {}));
  assert.equal(st.status, "ok");
  const n = sc(await s.call("pcraft_normalize", { workspaceId: root, path: "settings/ok.json", fields: "fields/3740.json" }));
  assert.equal(n.status, "ok", JSON.stringify(n));
  const p = sc(await preview(s, root, "settings/ok.json"));
  assert.equal(p.status, "ok", JSON.stringify(p));
  assert.equal(p.result.results[0].pages, 1);
}

test("時間の上限: 重い帳票の preview は failed（EvalTimeoutError。決まった文）で描かず、同じサーバーが次の要求に答える", { skip: skip9 }, async () => {
  const root = workspaceWith("ARRAY_COUNT(ARRAY_FOR(100000, i, ARRAY_COUNT(ARRAY_FOR(100000, j, i))))");
  const s = await connectClaudeCode([root], { PCRAFT_PLUGIN_ZIP: ZIP9, PCRAFT_EVAL_TIMEOUT_SEC: "1" });
  try {
    const t0 = Date.now();
    const r = sc(await preview(s, root, "settings/heavy.json"));
    assert.deepEqual([r.status, r.error.code], ["failed", "EvalTimeoutError"], JSON.stringify(r));
    assert.match(r.error.message, /1 秒を超えたので止めた/);
    assert.ok(Date.now() - t0 < 10_000, `止めるのが遅い（${Date.now() - t0} ms）`);
    assert.equal(existsSync(path.join(root, "out", "見積書.html")), false, "描かない");
    await stillAnswers(s, root);
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("メモリの上限: 大きな値を作る帳票の preview は failed（EvalMemoryError）で描かず、同じサーバーが次の要求に答える（子プロセス）", { skip: skip9 }, async () => {
  const root = workspaceWith('ARRAY_COUNT(ARRAY_FOR(30, j, ARRAY_FOR(100000, i, CONCAT("abcdefghij", i, j))))');
  const s = await connectClaudeCode([root], { PCRAFT_PLUGIN_ZIP: ZIP9, PCRAFT_EVAL_HEAP_MB: "64" });
  try {
    const r = sc(await preview(s, root, "settings/heavy.json"));
    assert.deepEqual([r.status, r.error.code], ["failed", "EvalMemoryError"], JSON.stringify(r));
    assert.match(r.error.message, /64 MiB/);
    await stillAnswers(s, root);
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
