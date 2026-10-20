// 印刷屋 Ver.9 の zip（中核 tools 2.2.0。0.2.1）: zip の decimal.js を読み、数学関数 M_* と財務関数 R_* を使う設定を保存・preview できる。
// Ver.8 までの zip（試験の既定は Ver.7）では、行の計算式の M_* / R_* が保存の検査（formula.syntax）で止まり、文に「印刷屋 Ver.9 から使える」が付く。
// HTML の ${…} は保存の検査で評価しないので保存でき、preview の式のエラー（場所と件数だけ）になる
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, SETTINGS_TEXT, SKIP as skip, connEnv, connectClaudeCode, makeConn, makeWorkspace, saveInput, sc } from "./helpers.mjs";

const ZIP9 = process.env.PCRAFT_TEST_PLUGIN_ZIP9 ?? path.resolve(ROOT, "../print-craft/dist/print-craft-plugin9.zip");
const SKIP9 = skip || (!existsSync(ZIP9) && `印刷屋 Ver.9 の zip が無い: ${ZIP9}（PCRAFT_TEST_PLUGIN_ZIP9 で指定できる）`);
const RECORD_TEXT = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "record-3740-3.json"), "utf8");
const FILE = "settings/APP3740-見積書-数学.json";

/** 見積書の本文に M_* / R_* を足した設定。html: HTML の ${…} に M_SIN・R_PMT、formula: 行の計算式に M_LOG・R_FV */
function withMath({ html = true, formula = true } = {}) {
  const s = JSON.parse(SETTINGS_TEXT);
  const body = s.pluginInfos[0].tagsInfo.fieldsInfo.find((f) => f.html !== undefined);
  const head = '<div class="pcraft-inv-header">見積書</div>';
  const tail = "  html\n)";
  assert.ok(body.html.includes(head) && body.formulaSet.endsWith(tail));
  const add = [html ? `<p>\${ESC_HTML(M_SIN(1))} / \${ESC_HTML(R_PMT(0.01, 12, 100000))}</p>` : "", formula ? "<p>##math##</p>" : ""].join("");
  body.html = body.html.replace(head, `${head}${add}`);
  if (formula) body.formulaSet = body.formulaSet.slice(0, -tail.length) + `  html,REPLACE(html, "##math##", CONCAT(ESC_HTML(M_LOG(100)), " / ", ESC_HTML(R_FV(0.01, 12, -1000)))),\n${tail}`;
  return JSON.stringify(s);
}

test("Ver.9 の zip: pcraft_status は版 9。M_* / R_* を使う設定を保存でき（エラー 0）、preview は 1 ページで式のエラー 0", { skip: SKIP9 }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const s = await connectClaudeCode([root], connEnv(conn.file, { PCRAFT_PLUGIN_ZIP: ZIP9 }));
  try {
    const st = sc(await s.call("pcraft_status", {}));
    assert.deepEqual([st.result.pluginZip.readable, st.result.pluginZip.compatible, st.result.pluginZip.pluginVersion], [true, true, "9"]);
    const saved = sc(await s.call("pcraft_save_settings", saveInput(root, FILE, withMath())));
    assert.equal(saved.status, "ok", JSON.stringify(saved.findings));
    assert.deepEqual(saved.findings.filter((f) => f.level === "error"), []);
    mkdirSync(path.join(root, "records"));
    writeFileSync(path.join(root, "records", "3740-3.json"), RECORD_TEXT);
    const p = sc(await s.call("pcraft_preview", { workspaceId: root, path: FILE, record: "records/3740-3.json", fields: "fields/3740.json" }));
    assert.equal(p.status, "ok", JSON.stringify(p));
    const [b] = p.result.results;
    assert.deepEqual([b.pages, b.errorCount], [1, 0]);
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Ver.8 までの zip（試験の既定 Ver.7）: 行の計算式の M_* / R_* は保存されず（invalid）、formula.syntax の文に「印刷屋 Ver.9 から使える」。HTML の ${…} だけなら保存でき、preview の式のエラー", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    const r = sc(await s.call("pcraft_save_settings", saveInput(root, FILE, withMath())));
    assert.equal(r.status, "invalid", JSON.stringify(r));
    const syntax = r.findings.filter((f) => f.level === "error" && f.rule === "formula.syntax");
    assert.ok(syntax.length >= 1, JSON.stringify(r.findings));
    assert.ok(syntax.every((f) => /印刷屋 Ver\.9 から使える/.test(f.message)), JSON.stringify(syntax));
    assert.equal(existsSync(path.join(root, FILE)), false, "保存しない");
    const onlyHtml = sc(await s.call("pcraft_save_settings", saveInput(root, FILE, withMath({ formula: false }))));
    assert.equal(onlyHtml.status, "ok", JSON.stringify(onlyHtml.findings));
    mkdirSync(path.join(root, "records"));
    writeFileSync(path.join(root, "records", "3740-3.json"), RECORD_TEXT);
    const p = sc(await s.call("pcraft_preview", { workspaceId: root, path: FILE, record: "records/3740-3.json", fields: "fields/3740.json" }));
    assert.equal(p.status, "ok", JSON.stringify(p));
    assert.equal(p.result.results[0].errorCount, 2, "M_SIN と R_PMT の 2 か所");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
