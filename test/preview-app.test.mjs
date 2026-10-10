// preview の MCP App（Desktop。実装案 16 章。2026-10-10 Takashi「MCP Apps で作る（B1 の中で）」）:
//   ツールの _meta.ui.resourceUri、表示の殻の資源（mimeType、インラインの script だけ、CSP）、結果の _meta の帳票の文書（content と structuredContent には値が無い）、
//   Claude Code には付けない、大きさの上限、表示の殻の描き方（happy-dom。iframe は sandbox="" と srcdoc、文字は textContent）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { FIELDS_TEXT, SKIP as skip, connEnv, connectClaudeCode, connectDesktop, makeConn, makeWorkspace, sc, settings } from "./helpers.mjs";
import { MESSAGES, fitAll, payloadOf, renderPreview } from "../src/ui/preview-view.ts";
import { previewMeta } from "../src/tools/preview-app.ts";
import { PREVIEW_MAX_BYTES, PREVIEW_META_KEY, PREVIEW_UI_URI } from "../src/preview-payload.ts";

const RECORD_TEXT = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "record-3740-3.json"), "utf8");
const VALUE = "□□□□株式会社";
const FILE = "kintone/dev/3740-見積書/見積書.json";

/** アプリのフォルダー（印は中核が作る）に項目定義・レコード 3・設定を置いた作業フォルダー */
function prepared() {
  const root = makeWorkspace();
  const conn = makeConn();
  const set = core.loadConnections(conn.file, { workspaceRoots: [root], env: {} });
  const dir = path.join(root, "kintone", "dev", "3740-見積書");
  core.ensureAppFolder(dir, core.pickProfile(set, "dev"), 3740);
  writeFileSync(path.join(dir, "fields.json"), FIELDS_TEXT);
  mkdirSync(path.join(dir, "records"));
  writeFileSync(path.join(dir, "records", "3.json"), RECORD_TEXT);
  writeFileSync(path.join(dir, "見積書.json"), settings());
  return { root, conn, cleanup: () => (conn.cleanup(), rmSync(root, { recursive: true, force: true })) };
}

test("Desktop: pcraft_preview は _meta.ui.resourceUri で表示の殻を指す。資源は text/html;profile=mcp-app、インラインの script だけ、CSP は Google Fonts だけ", { skip }, async () => {
  const w = prepared();
  const s = await connectDesktop(w.root, connEnv(w.conn.file));
  try {
    const { tools } = await s.client.listTools();
    const preview = tools.find((t) => t.name === "pcraft_preview");
    assert.equal(preview._meta?.ui?.resourceUri, PREVIEW_UI_URI);
    assert.equal(preview._meta?.["ui/resourceUri"], PREVIEW_UI_URI, "古いホスト向けの形も");
    assert.ok(tools.filter((t) => t.name !== "pcraft_preview").every((t) => !t._meta?.ui), "ほかのツールには付けない");
    const { resources } = await s.client.listResources();
    const listed = resources.find((r) => r.uri === PREVIEW_UI_URI);
    assert.equal(listed?.mimeType, "text/html;profile=mcp-app");
    const read = await s.client.readResource({ uri: PREVIEW_UI_URI });
    const [c] = read.contents;
    assert.equal(c.mimeType, "text/html;profile=mcp-app");
    assert.match(c.text, /^<!doctype html>/);
    assert.match(c.text, /<script>[\s\S]+<\/script>/, "束ねた script をインラインで");
    assert.doesNotMatch(c.text, /<script[^>]+src=/i, "外の script を読まない");
    assert.match(c.text, /ui\/initialize/, "握手のコード（ext-apps の App）");
    assert.equal((c.text.match(/<\/script>/gi) ?? []).length, 1, "script の中に </script> が無い");
    assert.deepEqual(c._meta?.ui?.csp, { resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"], connectDomains: [], frameDomains: [] });
  } finally {
    await s.close();
    w.cleanup();
  }
});

test("Desktop: pcraft_preview の結果の _meta に帳票の文書（レコードの値を含む）。content と structuredContent には値が無い", { skip }, async () => {
  const w = prepared();
  const s = await connectDesktop(w.root, connEnv(w.conn.file));
  try {
    const r = await s.call("pcraft_preview", { path: FILE, record: "3" });
    assert.equal(sc(r).status, "ok", JSON.stringify(sc(r)));
    const payload = r._meta?.[PREVIEW_META_KEY];
    assert.equal(payload?.version, 1);
    const [b] = payload.buttons;
    assert.equal(b.menu, "見積書");
    assert.equal(b.pages, 1);
    assert.match(b.paper, /^A4 縦 96 dpi$/);
    assert.ok(b.width > 700 && b.height > 1000, `${b.width} x ${b.height}`);
    assert.ok(b.inner.includes(VALUE), "帳票の文書にはレコードの値がある（UI にだけ）");
    assert.match(b.inner, /Content-Security-Policy/);
    assert.ok(!r.content[0].text.includes(VALUE) && !JSON.stringify(r.structuredContent).includes(VALUE), "モデル向けの content と structuredContent には値を入れない");
    assert.ok(!r.content[0].text.includes("rex0220-pcraft-page"), "content に帳票の HTML を入れない");
    assert.match(sc(r).result.note, /会話の中のプレビュー（MCP App）に表示される/);
    assert.match(sc(r).result.note, /out\/ の HTML を読んだり、ほかのツールで会話に出したりしない/);
  } finally {
    await s.close();
    w.cleanup();
  }
});

test("Claude Code: ツールの定義・資源・結果に MCP App のものを付けない（表示しないので）", { skip }, async () => {
  const w = prepared();
  const s = await connectClaudeCode([w.root], connEnv(w.conn.file));
  try {
    const { tools } = await s.client.listTools();
    assert.ok(tools.every((t) => !t._meta?.ui && !t._meta?.["ui/resourceUri"]));
    let uris = [];
    try {
      uris = (await s.client.listResources()).resources.map((r) => r.uri);
    } catch {
      uris = []; // 資源が無ければ resources の機能を出さない
    }
    assert.ok(!uris.includes(PREVIEW_UI_URI));
    const r = await s.call("pcraft_preview", { workspaceId: w.root, path: FILE, record: "3" });
    assert.equal(sc(r).status, "ok", JSON.stringify(sc(r)));
    assert.equal(r._meta?.[PREVIEW_META_KEY], undefined);
    assert.ok(!JSON.stringify(r).includes(VALUE));
    assert.match(sc(r).result.note, /Chrome で開いてもらう（AI はブラウザーを起動しない）$/);
  } finally {
    await s.close();
    w.cleanup();
  }
});

test("大きさの上限: 結果の _meta 全体の JSON（UTF-8）が 4 MiB を超えたら帳票を入れない（omitted）。ちょうどは入れる、1 バイト超えは省く、マルチバイト・JSON の逃がし・誤りの文も数える（Codex の MCP App のレビュー MINOR 2）", () => {
  const one = { menu: "a", fileName: "a.pdf", pageSize: "A4", orientation: "p", dpi: "96", pages: 1, errors: [], html: '<iframe sandbox="" title="a" width="834" height="1203" srcdoc="">' };
  const small = previewMeta([{ ...one, inner: "<p>x</p>" }])[PREVIEW_META_KEY];
  assert.deepEqual([small.buttons.length, small.buttons[0].width, small.buttons[0].height, small.buttons[0].paper], [1, 834, 1203, "A4 縦 96 dpi"]);
  assert.deepEqual(previewMeta([{ ...one, orientation: "l", html: "壊れた", inner: "" }])[PREVIEW_META_KEY].buttons[0].paper, "A4 横 96 dpi");
  const bytes = (meta) => Buffer.byteLength(JSON.stringify(meta), "utf8");
  const base = bytes(previewMeta([{ ...one, inner: "" }]));
  const TOO_LARGE = { version: 1, buttons: [], omitted: "too-large" };
  const exact = previewMeta([{ ...one, inner: "x".repeat(PREVIEW_MAX_BYTES - base) }]);
  assert.equal(bytes(exact), PREVIEW_MAX_BYTES);
  assert.equal(exact[PREVIEW_META_KEY].buttons.length, 1, "ちょうど上限は入れる");
  assert.deepEqual(previewMeta([{ ...one, inner: "x".repeat(PREVIEW_MAX_BYTES - base + 1) }])[PREVIEW_META_KEY], TOO_LARGE, "1 バイト超えは省く");
  const room = PREVIEW_MAX_BYTES - base;
  assert.deepEqual(previewMeta([{ ...one, inner: "あ".repeat(Math.floor(room / 3) + 1) }])[PREVIEW_META_KEY], TOO_LARGE, "文字数でなく UTF-8 のバイト数");
  assert.deepEqual(previewMeta([{ ...one, inner: '"'.repeat(Math.floor(room / 2) + 1) }])[PREVIEW_META_KEY], TOO_LARGE, "JSON の逃がし（\\\"）も数える");
  assert.deepEqual(previewMeta([{ ...one, inner: "<p>x</p>", errors: ["e".repeat(room)] }])[PREVIEW_META_KEY], TOO_LARGE, "誤りの文も数える");
  assert.deepEqual(previewMeta([{ ...one, inner: "x".repeat(room / 2) }, { ...one, inner: "y".repeat(room / 2) }])[PREVIEW_META_KEY], TOO_LARGE, "ボタンが 2 つなら 2 つ目の名前などの分も数える");
});

test("表示の殻の描き方（happy-dom）: iframe は sandbox=\"\" と srcdoc、ボタン名などは文字（HTML にしない）、データが無い・壊れている・大きすぎるときは決まった文、幅に合わせて縮める", () => {
  const win = new Window();
  const doc = win.document;
  const root = doc.createElement("div");
  doc.body.append(root);
  const evil = '<img src=x onerror="alert(1)">';
  const meta = { [PREVIEW_META_KEY]: { version: 1, buttons: [{ menu: evil, fileName: evil, paper: "A4 縦 96 dpi", pages: 1, width: 800, height: 1200, errors: [evil], inner: "<!doctype html><p>帳票</p>" }] } };
  const frames = renderPreview(root, payloadOf(meta));
  const iframe = root.querySelector("iframe");
  assert.equal(iframe.getAttribute("sandbox"), "");
  assert.equal(iframe.getAttribute("srcdoc"), "<!doctype html><p>帳票</p>");
  assert.equal(root.querySelector("img"), null, "ボタン名・ファイル名・誤りの文を HTML にしない");
  assert.equal(root.querySelector("h2").textContent, evil);
  fitAll(frames, 400);
  assert.equal(iframe.style.transform, "scale(0.5)");
  assert.deepEqual([frames[0].style.width, frames[0].style.height], ["400px", "600px"]);
  fitAll(frames, 2000);
  assert.equal(iframe.style.transform, "scale(1)", "大きくはしない");
  for (const [m, text] of [[undefined, MESSAGES.missing], [{}, MESSAGES.missing], [{ [PREVIEW_META_KEY]: { version: 2, buttons: [] } }, MESSAGES.missing], [{ [PREVIEW_META_KEY]: { version: 1, buttons: [{ menu: "a" }] } }, MESSAGES.missing], [{ [PREVIEW_META_KEY]: { version: 1, buttons: [], omitted: "too-large" } }, MESSAGES.tooLarge]]) {
    renderPreview(root, payloadOf(m));
    assert.equal(root.textContent, text, JSON.stringify(m));
    assert.equal(root.querySelector("iframe"), null);
  }
  win.close();
});
