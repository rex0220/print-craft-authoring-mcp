// 評価の子プロセスの入口（dist/server/eval-worker.cjs。中核の dist/eval-worker.mjs を happy-dom ごと束ねたもの。print-craft の docs/authoring-try-plan.md 4.6、T0a）:
// 中核の runEval が workerFile でこの入口を fork し、zip の式を親と違うプロセスで評価する。moment は束ねた本体の 1 つ上の vendor/ から読む（DATE_FORMAT）。
// Worker thread（isolation thread）でも動く（Desktop）。中核 2.3.0 から（それより前の中核には runEval が無いので飛ばす）
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { ROOT, SKIP as skip, ZIP } from "./helpers.mjs";

const WORKER = path.join(ROOT, "dist", "server", "eval-worker.cjs");
const ZIP9 = process.env.PCRAFT_TEST_PLUGIN_ZIP9 ?? path.resolve(ROOT, "../print-craft/dist/print-craft-plugin9.zip");
const noRunEval = typeof core.runEval !== "function" && "中核に runEval が無い（tools 2.3.0 から）";

test("束ねた入口で式を評価: 親と違うプロセス、Ver.7 の zip、moment（vendor/）を使う DATE_FORMAT", { skip: skip || noRunEval }, async () => {
  assert.ok(existsSync(WORKER), WORKER);
  const r = await core.runEval({ kind: "formulas", pluginZip: ZIP, formulas: ["1+1", 'DATE_FORMAT("2026-01-15", "YYYY/MM/DD")', "zz"] }, { workerFile: WORKER });
  assert.notEqual(r.diag.pid, process.pid);
  assert.deepEqual(r.formulas[0], { text: "2", raw: 2 });
  assert.equal(r.formulas[1].text, "2026/01/15");
  assert.match(r.formulas[2].evaluationError, /FIELD CODE NOT FOUND: zz/);
  assert.deepEqual([r.diag.stdoutChars, r.diag.stderrChars], [0, 0]);
});

test("束ねた入口で Ver.9 の zip の M_* / R_*（decimal.js）", { skip: skip || noRunEval || (!existsSync(ZIP9) && `Ver.9 の zip が無い: ${ZIP9}`) }, async () => {
  const r = await core.runEval({ kind: "formulas", pluginZip: ZIP9, formulas: ["M_SIN(1)", "R_PMT(0.01, 12, 100000)"] }, { workerFile: WORKER });
  assert.equal(r.engine.pluginVersion, "9");
  assert.deepEqual(r.formulas, [{ text: "0.84147098480789650665" }, { text: "-8884.87886783417073399878312279" }]);
});

test("束ねた入口は Worker thread でも動く（Claude Desktop の Electron の Node は子プロセスを起こせないので thread。0.3.0）", { skip: skip || noRunEval || (!existsSync(ZIP9) && `Ver.9 の zip が無い: ${ZIP9}`) }, async () => {
  const r = await core.runEval({ kind: "formulas", pluginZip: ZIP9, formulas: ["M_SIN(1)", 'DATE_FORMAT("2026-01-15", "YYYY/MM/DD")'] }, { workerFile: WORKER, isolation: "thread" });
  assert.equal(r.diag.isolation, "thread");
  assert.equal(r.diag.pid, process.pid);
  assert.deepEqual(r.formulas.map((f) => f.text), ["0.84147098480789650665", "2026/01/15"]);
});
