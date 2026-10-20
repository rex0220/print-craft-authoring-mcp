// pcraft_try（お試しアプリで式と帳票を試す。0.3.0。print-craft の docs/authoring-try-plan.md 4.2〜4.5、T3）:
//   - 式: 値とエラーの文を返す（架空の値）。帳票は書かない
//   - ボタン: ページの文字・ファイル名・表示条件を返し、作業フォルダーの out/try/<app>-<番号>.html に書く。Desktop は _meta に帳票（会話の中のプレビュー）
//   - 描けなかった対象（gantt の rows 1,001 = 関連レコード一覧の上限）は refused で、前の結果のファイルを消す
//   - 入力の誤りは invalid（InputError）、ボタンの設定の誤りは invalid（NormalizeError）。ツールの説明に使う場面の決まり
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { ROOT, SKIP as skip, connectClaudeCode, connectDesktop, makeWorkspace, sc } from "./helpers.mjs";
import { PREVIEW_META_KEY } from "../src/preview-payload.ts";

const ZIP9 = process.env.PCRAFT_TEST_PLUGIN_ZIP9 ?? path.resolve(ROOT, "../print-craft/dist/print-craft-plugin9.zip");
const noTry = typeof core.tryInChild !== "function" && "中核に tryInChild が無い（tools 2.3.0 から）";
const skip9 = skip || noTry || (!existsSync(ZIP9) && `Ver.9 の zip が無い: ${ZIP9}`);
const PAGE = (body) => `<div class="rex0220-pcraft-page">${body}</div>`;

test("Claude Code: 式は値とエラーの文を返し、帳票は書かない。ボタンはページの文字を返して out/try/ に書く。gantt の 1,001 行は作らず前の結果を消す", { skip: skip9 }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root], { PCRAFT_PLUGIN_ZIP: ZIP9 });
  try {
    const { tools } = await s.client.listTools();
    const t = tools.find((x) => x.name === "pcraft_try");
    assert.match(t.description, /資料（pcraft_docs）で答え/);
    assert.match(t.description, /formulas 10 件まで、または button 1 つ/);
    assert.match(t.description, /項目コードはお試しアプリのもので、利用者の設定に書かない/);
    assert.equal(t.annotations.readOnlyHint, false);
    assert.equal(t.inputSchema.additionalProperties, false);

    const f = sc(await s.call("pcraft_try", { workspaceId: root, formulas: [{ formula: 'DATE_FORMAT(日付1, "YYYY/MM/DD")' }, { formula: "zz" }] }));
    assert.equal(f.status, "ok", JSON.stringify(f));
    assert.deepEqual(f.result.formulas[0].values.map((v) => v.text), ["2026/01/15", "2026/02/28", ""]);
    assert.equal(f.result.formulas[1].values[0].evaluationError, "getVal FIELD CODE NOT FOUND: zz");
    assert.deepEqual(f.result.written, []);

    const b = sc(await s.call("pcraft_try", { workspaceId: root, app: "quote", records: [1], button: { html: PAGE("${ESC_HTML(宛名)} 様"), fileNameFormula: '"見積-" & 見積番号' } }));
    assert.equal(b.status, "ok", JSON.stringify(b));
    const [r1] = b.result.button.results;
    assert.deepEqual([r1.pages, r1.pageTexts[0].text, r1.fileName.value], [1, "株式会社あれこれ 様", "見積-A-20260224-001.pdf"]);
    assert.deepEqual(b.result.written, ["out/try/quote-1.html"]);
    assert.match(readFileSync(path.join(root, "out", "try", "quote-1.html"), "utf8"), /株式会社あれこれ/);
    assert.equal(b._meta, undefined, "Claude Code には _meta を付けない");

    mkdirSync(path.join(root, "out", "try"), { recursive: true });
    writeFileSync(path.join(root, "out", "try", "gantt-rows.html"), "old");
    const g = sc(await s.call("pcraft_try", { workspaceId: root, app: "gantt", rows: 1001, button: { html: PAGE("${COUNTROW(task_list)}") } }));
    assert.equal(g.status, "ok");
    assert.deepEqual(g.result.refused.map((x) => x.code), ["related.tooMany"]);
    assert.deepEqual(g.result.removed, ["out/try/gantt-rows.html"]);
    assert.equal(existsSync(path.join(root, "out", "try", "gantt-rows.html")), false);

    const bad = sc(await s.call("pcraft_try", { workspaceId: root, app: "quote", count: 3, formulas: [{ formula: "1" }] }));
    assert.deepEqual([bad.status, bad.error.code], ["invalid", "InputError"]);
    assert.match(bad.error.message, /count を使えない/);
    // 3 行目の計算式の知らない項目は検査で止まる（HTML の ${…} は検査で評価しないので止まらない。印刷屋の設定画面と同じ）
    const invalid = sc(await s.call("pcraft_try", { workspaceId: root, app: "quote", button: { html: PAGE("x"), bodyFormula: "zz" } }));
    assert.deepEqual([invalid.status, invalid.error.code], ["invalid", "NormalizeError"], JSON.stringify(invalid));
    assert.ok(invalid.findings.some((x) => x.level === "error"));
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop: 式だけの試しは _meta に「帳票なし（式だけ）」の印（表示の殻が「データが届きませんでした」と出さない。0.3.1）", { skip: skip9 }, async () => {
  const root = makeWorkspace();
  const s = await connectDesktop(root, { PCRAFT_PLUGIN_ZIP: ZIP9 });
  try {
    const r = await s.call("pcraft_try", { app: "formula-sample", records: [1], formulas: [{ formula: "ESC_HTML(\"<b>\")" }] });
    assert.equal(sc(r).status, "ok", JSON.stringify(sc(r)));
    assert.deepEqual(r._meta?.[PREVIEW_META_KEY], { version: 1, buttons: [], kind: "formulas" });
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop: ボタンの帳票を _meta（会話の中のプレビュー）にも入れる。帳票は掃除した inner", { skip: skip9 }, async () => {
  const root = makeWorkspace();
  const s = await connectDesktop(root, { PCRAFT_PLUGIN_ZIP: ZIP9 });
  try {
    const r = await s.call("pcraft_try", { app: "quote", records: [1, 2], button: { html: PAGE("<h1>${ESC_HTML(宛名)}</h1>") } });
    assert.equal(sc(r).status, "ok", JSON.stringify(sc(r)));
    const payload = r._meta?.[PREVIEW_META_KEY];
    assert.ok(payload, "結果の _meta に帳票");
    assert.deepEqual(payload.buttons.map((x) => [x.menu, x.pages]), [["お試し（レコード 1）", 1], ["お試し（レコード 2）", 1]]);
    assert.match(payload.buttons[0].inner, /株式会社あれこれ/);
    assert.deepEqual(sc(r).result.written, ["out/try/quote-1.html", "out/try/quote-2.html"]);
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
