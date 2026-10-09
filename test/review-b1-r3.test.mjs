// Codex の B1 3 回目のレビュー（work-link/codex-review-print-craft-b1-r3-2026-10-10.md）の指摘の試験:
//   MAJOR 1 zip のコードを動かした後の読み込みの失敗は restart-required（失敗した zip のグローバルを残したまま次を読まない）
//   MINOR 1 console を捨てるのは印刷屋のエンジンの処理の文脈だけ（遅れて出るものも捨て、同時に動くほかの出力は捨てない）
//   MINOR 2 作業フォルダーの置き換えは境界と Windows の大文字小文字・区切りを見る。JSON の読み込みの境は決まった文
//   describeZipError の全種類
// src のモジュールを直接読む試験（console-gate.ts、result.ts、zip-error.ts）と、束ねた本体の試験
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PluginZipError } from "@rex0220/print-craft-authoring-tools/core";
import { installConsoleGate, quietly } from "../src/console-gate.ts";
import { rootPattern, sanitizeMessage, setScrubRoots } from "../src/result.ts";
import { describeZipError } from "../src/zip-error.ts";
import { SKIP as skip, ZIP, connectClaudeCode, makeWorkspace, saveInput, sc } from "./helpers.mjs";
import { makePluginZip, stubInnerEntries } from "./zip-stub.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("console-gate: 印刷屋の処理の文脈（quietly の中と、そこから続くタイマー・Promise）の出力は捨てる。同時に動くほかの出力と、外の出力は標準エラーへ（標準出力には出さない）", async () => {
  const reported = [];
  const captured = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => {
    captured.push(String(chunk));
    return typeof rest.at(-1) === "function" ? (rest.at(-1)(), true) : true;
  };
  try {
    installConsoleGate((line) => reported.push(line));
    const inside = quietly(async () => {
      console.log("A-内側の値");
      console.warn("A-警告");
      console.dir({ a: "A-dir" });
      console.table([{ x: "A-table" }]);
      setTimeout(() => console.log("A-遅れて出る値"), 20);
      Promise.resolve().then(() => console.error("A-Promise の値"));
      await sleep(5);
      await quietly(async () => console.log("A-重ねた内側"));
    });
    console.log("B-同時に動くほかの出力");
    await inside;
    console.log("C-外の出力");
    await sleep(40);
  } finally {
    process.stderr.write = write;
  }
  const text = captured.join("");
  assert.ok(!/A-/.test(text), `印刷屋の処理の文脈の出力は捨てる: ${text}`);
  assert.match(text, /B-同時に動くほかの出力/);
  assert.match(text, /C-外の出力/);
  assert.equal(reported.length, 1, "一番外の quietly が終わったときに 1 行");
  assert.match(reported[0], /console の出力を \d+ 件捨てた/);
});

test("sanitizeMessage: 作業フォルダーはルートそのものか区切りが続くときだけ置き換える（似た名前の別のフォルダーには当てない）。区切りの混在、Windows の大文字小文字と UNC", () => {
  setScrubRoots(["/work/app/"]);
  assert.equal(sanitizeMessage("/work/app/settings/x.json を読めない"), "settings/x.json を読めない");
  assert.equal(sanitizeMessage("/work/app-copy/x.json と /work/apple"), "/work/app-copy/x.json と /work/apple", "名前の続きには当てない");
  assert.equal(sanitizeMessage("（/work/app）の外"), "（（作業フォルダー））の外");
  assert.equal(sanitizeMessage("場所: /work/app"), "場所: （作業フォルダー）");
  assert.equal(sanitizeMessage("\\work\\app\\settings\\x.json"), "settings\\x.json", "区切りが \\ でも");
  assert.equal(sanitizeMessage("/WORK/APP/x.json"), "/WORK/APP/x.json", "Windows 以外は大文字小文字を区別する");
  setScrubRoots(["C:\\Users\\a\\ws", "\\\\srv\\share\\ws"], "win32");
  assert.equal(sanitizeMessage("c:/users/A/WS/settings/x.json を読めない"), "settings/x.json を読めない", "Windows はドライブ名・大文字小文字・区切りが違っても");
  assert.equal(sanitizeMessage("C:\\Users\\a\\ws2\\x.json"), "C:\\Users\\a\\ws2\\x.json");
  assert.equal(sanitizeMessage("\\\\srv\\share\\ws\\records\\3.json"), "records\\3.json", "UNC");
  assert.ok(rootPattern("/a/b").flags.includes("g") && !rootPattern("/a/b").flags.includes("i"));
  setScrubRoots(["/"]);
  assert.equal(sanitizeMessage("/x/y"), "/x/y", "短すぎるルート（/ など）は置き換えない");
  setScrubRoots([]);
  assert.equal(sanitizeMessage(`a.json を JSON として読めない: Unexpected token '山', "{"name": 山田太郎}" is not valid JSON`), "a.json を JSON として読めない: JSON として読めない（中身は返さない）");
});

test("describeZipError: すべての種類に決まった文。読めない / 読めるが合わない、incompatible / failed の分け方。zip-changed と restart-required は求めた zip の版を出さない", () => {
  const cases = [
    ["not-configured", false, false],
    ["missing", false, false],
    ["unreadable", false, false],
    ["not-print-craft", true, false],
    ["unsupported-version", true, true],
    ["no-api", true, false],
    ["engine-unreadable", true, false],
    ["api-unreadable", true, false],
    ["api-unsupported", true, true],
    ["api-mismatch", true, false],
    ["api-incomplete", true, true],
    ["zip-changed", undefined, false],
    ["restart-required", undefined, false]
  ];
  for (const [code, readable, incompatible] of cases) {
    const e = new PluginZipError(`/secret/path/${code}.zip の生の文`, code, { pluginVersion: "6", apiVersion: 3, previous: "api-incomplete" });
    for (const surface of ["desktop", "claude-code"]) {
      const r = describeZipError(e, surface);
      assert.equal(r.code, code);
      assert.equal(r.readable, readable, `${code} の readable`);
      assert.equal(r.incompatible, incompatible, `${code} の incompatible`);
      assert.ok(r.text && !/undefined|\/secret\/path|生の文/.test(r.text), `${code}: ${r.text}`);
      if (readable === undefined) assert.ok(!("pluginVersion" in r) && !("authoringApiVersion" in r), `${code} は版を出さない`);
      else if (readable) assert.equal(r.pluginVersion, "6");
    }
  }
  assert.match(describeZipError(new PluginZipError("x", "restart-required", { previous: "api-incomplete" }), "desktop").text, /api-incomplete.*Claude Desktop を起動し直す/);
  assert.match(describeZipError(new PluginZipError("x", "zip-changed"), "claude-code").text, /\/mcp で print-craft を再接続/);
  const other = describeZipError(new TypeError("/secret/path の文"), "desktop");
  assert.equal(other.code, "unexpected");
  assert.ok(!/secret/.test(other.text) && /TypeError/.test(other.text));
});

test("MAJOR 1: zip のコードを動かした後に失敗したら、そのサーバーでは別の zip も読み込まない（restart-required。診断は再接続を案内、ツールは failed）", { skip }, async () => {
  const zips = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-r3-")));
  const [bad, good] = [makeWorkspace(), makeWorkspace()];
  writeFileSync(path.join(zips, "stub.zip"), makePluginZip(stubInnerEntries()));
  copyFileSync(ZIP, path.join(zips, "good.zip"));
  writeFileSync(path.join(bad, ".env"), `PCRAFT_PLUGIN_ZIP=${path.join(zips, "stub.zip")}\n`);
  writeFileSync(path.join(good, ".env"), `PCRAFT_PLUGIN_ZIP=${path.join(zips, "good.zip")}\n`);
  const s = await connectClaudeCode([bad, good], {});
  try {
    const first = sc(await s.call("pcraft_workspace_status", { workspaceId: bad }));
    assert.equal(first.result.pluginZip.code, "api-incomplete", JSON.stringify(first.result.pluginZip));
    const next = sc(await s.call("pcraft_workspace_status", { workspaceId: good }));
    assert.equal(next.result.pluginZip.code, "restart-required", JSON.stringify(next.result.pluginZip));
    assert.equal(next.result.ready, false);
    assert.match(next.result.pluginZip.problem, /api-incomplete.*\/mcp で print-craft を再接続/);
    assert.ok(!("pluginVersion" in next.result.pluginZip), "前の zip の版を、求めた zip の版として出さない");
    const save = sc(await s.call("pcraft_save_settings", saveInput(good, "settings/x.json")));
    assert.deepEqual([save.status, save.error.code], ["failed", "PluginZipError"], JSON.stringify(save));
  } finally {
    await s.close();
    for (const r of [bad, good]) rmSync(r, { recursive: true, force: true });
    rmSync(zips, { recursive: true, force: true });
  }
});

test("MINOR 2: 項目定義・レコード・設定のファイルが JSON として読めないときは、決まった文と位置だけ（中身を返さない）", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  const VALUE = "山田太郎の会社";
  try {
    assert.equal(sc(await s.call("pcraft_save_settings", saveInput(root, "settings/見積書.json"))).status, "ok");
    writeFileSync(path.join(root, "fields", "broken.json"), `{\n  "appId": 3740,\n  "properties": { "宛名": ${VALUE} }\n}`);
    const n = sc(await s.call("pcraft_normalize", { workspaceId: root, path: "settings/見積書.json", fields: "fields/broken.json" }));
    assert.deepEqual([n.status, n.error.code], ["invalid", "InputError"]);
    assert.match(n.error.message, /^項目定義のファイルを JSON として読めない: fields\/broken\.json.*（中身は返さない）$/);
    mkdirSync(path.join(root, "records"));
    writeFileSync(path.join(root, "records", "broken.json"), `{"record": {"宛名": {"type": "SINGLE_LINE_TEXT", "value": "${VALUE}"`);
    const p = sc(await s.call("pcraft_preview", { workspaceId: root, path: "settings/見積書.json", record: "records/broken.json", fields: "fields/3740.json" }));
    assert.match(p.error.message, /^レコードのファイルを JSON として読めない: records\/broken\.json.*（中身は返さない）$/);
    // 位置が入る形の誤り（カンマが無い）は行と列を残す。Unexpected token の形は位置が無い
    writeFileSync(path.join(root, "settings", "broken.json"), `{\n  "pluginID": "${VALUE}" "x": 1\n}`);
    const b = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/broken.json" }));
    assert.match(b.error.message, /^settings\/broken\.json を JSON として読めない（2 行 \d+ 列）（中身は返さない）$/);
    writeFileSync(path.join(root, "settings", "broken2.json"), `{\n  "pluginID": ${VALUE}\n}`);
    const b2 = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/broken2.json" }));
    assert.equal(b2.error.message, "settings/broken2.json を JSON として読めない（中身は返さない）");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
  assert.ok(!s.output().includes(VALUE), "中身を応答にも標準エラーにも出さない");
});
