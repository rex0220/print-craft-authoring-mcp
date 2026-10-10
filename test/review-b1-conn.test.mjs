// Codex の実装レビュー（接続のファイル。work-link/codex-review-print-craft-b1-conn-impl-2026-10-10.md）の指摘の試験:
//   BLOCKER 1 pcraft_take が読めない inbox のファイルの中身（JSON の断片）・絶対パスを返さない / MAJOR 3 アプリのフォルダーの設定は同じフォルダーの fields.json だけ /
//   MAJOR 4 pcraft_take は印の合わないフォルダーで conflict / 15.6 呼び出しの途中の接続の変化（kintone の偽物が最初の要求で接続のファイルを書き換える）
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { CONN, FIELDS_TEXT, SETTINGS_TEXT, SKIP as skip, ZIP, connEnv, connectClaudeCode, connectDesktop, leakedTokens, makeConn, makeWorkspace, sc, settings } from "./helpers.mjs";

const RECORD_TEXT = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "record-3740-3.json"), "utf8");
const APP_DIR = "kintone/dev/3740-見積書(印刷屋)";
const DL = "rex0220-print-craft-app3740-20261005-125115.json";
const errorOf = (r) => [r.isError, sc(r).ok, sc(r).status, sc(r).error?.code];

/** 印刷屋の設定のダウンロードと同じ形（封筒） */
async function snapshotText() {
  const engine = await core.loadEngine({ pluginZip: ZIP });
  const r = await core.normalizeSettings({ settingsText: SETTINGS_TEXT, settingsFile: "settings/a.json", fields: JSON.parse(FIELDS_TEXT), engine });
  return { text: `${JSON.stringify(r.output, null, 2)}\n`, engine, output: r.output };
}

test("BLOCKER 1: pcraft_take は読めない inbox のファイルの理由を決まった文で返す（JSON の断片・秘密の値・環境変数の名前・絶対パスを返さない）", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const SENTINEL = "SECRET-tok-0123456789";
  mkdirSync(path.join(root, "inbox"));
  writeFileSync(path.join(root, "inbox", DL), `{"pluginID":"rex0220 Print craft plugin","token":${SENTINEL},"ref":"env:MY_SECRET_VAR"}`);
  const s = await connectClaudeCode([root], connEnv(conn.file));
  try {
    const r = sc(await s.call("pcraft_take", { workspaceId: root }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.match(r.result.skipped[0].reason, /^JSON として読めない.*（中身は返さない）$/);
    for (const v of [SENTINEL, "MY_SECRET_VAR", root]) assert.ok(!s.output().includes(v), `返さない: ${v}`);
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MAJOR 4: pcraft_take は印の合わない今あるフォルダーで conflict（何も移さない。同じものでも inbox から消さない）", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const { text } = await snapshotText();
  const s = await connectClaudeCode([root], connEnv(conn.file));
  try {
    mkdirSync(path.join(root, "inbox"));
    writeFileSync(path.join(root, "inbox", DL), text);
    assert.equal(sc(await s.call("pcraft_take", { workspaceId: root })).status, "ok");
    const dir = path.join(root, "kintone", "dev");
    const [folder] = readdirSync(dir).filter((n) => !n.startsWith("."));
    // 同じ名前の profile の接続先を変えた（印は前の接続のもの）
    conn.write({ ...CONN, profiles: { ...CONN.profiles, dev: { ...CONN.profiles.dev, baseUrl: "https://x.cybozu.com" } } });
    const dl2 = DL.replace("125115", "125116");
    writeFileSync(path.join(root, "inbox", dl2), text);
    writeFileSync(path.join(root, "inbox", DL), text);
    assert.deepEqual(errorOf(await s.call("pcraft_take", { workspaceId: root })), [true, false, "conflict", "app-identity-conflict"]);
    assert.ok(!existsSync(path.join(dir, folder, dl2)), "置かない");
    assert.ok(existsSync(path.join(root, "inbox", dl2)) && existsSync(path.join(root, "inbox", DL)), "inbox に残す");
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("r2 MAJOR: pcraft_take は同じアプリでアプリ名の違うダウンロードを一度に置いても、アプリのフォルダーを 1 つだけ作る（一番新しいダウンロードのアプリ名）", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const { text } = await snapshotText();
  const base = JSON.parse(text);
  const s = await connectClaudeCode([root], connEnv(conn.file));
  try {
    mkdirSync(path.join(root, "inbox"));
    const older = "rex0220-print-craft-app3740-20261001-090000.json";
    const newer = "rex0220-print-craft-app3740-20261002-090000.json";
    writeFileSync(path.join(root, "inbox", older), JSON.stringify({ ...base, appName: "旧名" }));
    writeFileSync(path.join(root, "inbox", newer), JSON.stringify({ ...base, appName: "新名" }));
    const r = sc(await s.call("pcraft_take", { workspaceId: root }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.deepEqual(r.result.skipped, []);
    assert.deepEqual(readdirSync(path.join(root, "kintone", "dev")).filter((n) => !n.startsWith(".")), ["3740-新名"]);
    const f = sc(await s.call("pcraft_files", { workspaceId: root, app: 3740 }));
    assert.deepEqual([f.status, f.result.snapshots], ["ok", [newer, older]], "その後も番号で使える（同じ番号のフォルダーが 2 つで止まらない）");
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MAJOR 3: アプリのフォルダーの設定の pcraft_normalize / pcraft_preview は、同じフォルダーの fields.json だけ（別の fields は denied。同じファイルなら渡してよい）", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const set = core.loadConnections(conn.file, { workspaceRoots: [root], env: {} });
  const dir = path.join(root, "kintone", "dev", "3740-見積書");
  core.ensureAppFolder(dir, core.pickProfile(set, "dev"), 3740);
  writeFileSync(path.join(dir, "fields.json"), FIELDS_TEXT);
  mkdirSync(path.join(dir, "records"));
  writeFileSync(path.join(dir, "records", "3.json"), RECORD_TEXT);
  writeFileSync(path.join(dir, "見積書.json"), settings());
  const other = path.join(root, "kintone", "prod", "3740-見積書");
  core.ensureAppFolder(other, core.pickProfile(set, "prod"), 3740);
  writeFileSync(path.join(other, "fields.json"), FIELDS_TEXT);
  const s = await connectClaudeCode([root], connEnv(conn.file));
  try {
    const file = "kintone/dev/3740-見積書/見積書.json";
    for (const fields of ["fields/3740.json", "kintone/prod/3740-見積書/fields.json"]) {
      for (const [tool, input] of [["pcraft_normalize", { path: file, fields }], ["pcraft_preview", { path: file, fields, record: "3" }]]) {
        const r = sc(await s.call(tool, { workspaceId: root, ...input }));
        assert.deepEqual([r.status, r.error?.code], ["denied", "PermissionError"], `${tool} ${fields}: ${JSON.stringify(r)}`);
        assert.match(r.error.message, /同じフォルダーの fields\.json で検査する/);
      }
    }
    assert.equal(sc(await s.call("pcraft_normalize", { workspaceId: root, path: file, fields: "kintone/dev/3740-見積書/fields.json" })).status, "ok", "同じファイルなら渡してよい");
    assert.ok(!existsSync(path.join(dir, "out")), "preview は書かない");
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("15.6: 呼び出しの途中で選んだ profile の接続が変われば conflict（connection-changed。fields / record / pull は書かない）。ほかの profile だけの書き換えなら続ける", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-rewrite-")));
  const instr = path.join(tmp, "rewrite.json");
  const config = path.join(tmp, "plugin-config.json");
  const { engine, output } = await snapshotText();
  const { date, pluginName, pluginID, PluginVersion, appId, appName, ...body } = output;
  writeFileSync(config, JSON.stringify(await engine.api.writeConfig({ ...body, pluginLastUpdate: "2026-10-05 10:00:00", pluginUpdater: "佐藤", pluginProductEnv: true }, "compressed")));
  const rotated = { ...CONN, profiles: { ...CONN.profiles, dev: { ...CONN.profiles.dev, tokenMap: { ...CONN.profiles.dev.tokenMap, APP3740: "rotated-token" } } } };
  const otherOnly = { ...CONN, profiles: { ...CONN.profiles, prod: { ...CONN.profiles.prod, baseUrl: "https://y.cybozu.com" } } };
  /** 次の kintone への最初の要求で、接続のファイルを content に書き換える */
  const rewriteOnFetch = (content) => writeFileSync(instr, JSON.stringify({ target: conn.file, content }));
  const s = await connectClaudeCode([root], connEnv(conn.file, { PCRAFT_TEST_REWRITE_CONN: instr, PCRAFT_TEST_PLUGIN_CONFIG: config }), { mockFetch: true });
  try {
    // fields: フォルダーを作る前に止まる（印を置かない）
    rewriteOnFetch(rotated);
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })), [true, false, "conflict", "connection-changed"]);
    assert.ok(!existsSync(path.join(root, "kintone", "dev")) || readdirSync(path.join(root, "kintone", "dev")).length === 0, "フォルダーを作らない");
    conn.write(CONN);
    rewriteOnFetch(otherOnly);
    assert.equal(sc(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })).status, "ok", "ほかの profile だけの書き換えでは止めない");
    // record
    conn.write(CONN);
    rewriteOnFetch(rotated);
    assert.deepEqual(errorOf(await s.call("pcraft_record", { workspaceId: root, app: 3740, id: 3 })), [true, false, "conflict", "connection-changed"]);
    assert.ok(!existsSync(path.join(root, APP_DIR, "records", "3.json")), "書かない");
    // pull
    conn.write(CONN);
    rewriteOnFetch(rotated);
    assert.deepEqual(errorOf(await s.call("pcraft_pull", { workspaceId: root, app: 3740 })), [true, false, "conflict", "connection-changed"]);
    assert.deepEqual(readdirSync(path.join(root, APP_DIR)).filter((n) => /^rex0220-print-craft-app/.test(n)), [], "pull のファイルを置かない");
    conn.write(CONN);
    rewriteOnFetch(otherOnly);
    assert.equal(sc(await s.call("pcraft_pull", { workspaceId: root, app: 3740 })).status, "ok");
    assert.deepEqual(leakedTokens(s.output()), []);
    assert.ok(!s.output().includes("rotated-token"));
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(tmp, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("手での確認 5: pcraft_preview の note は、Desktop では会話の中の MCP App に表示される（AI は out/ の HTML を読まない・会話に出さない。実装案 16 章）、Claude Code では Chrome で開いてもらう", { skip }, async () => {
  for (const [surface, re] of [["desktop", /^帳票は会話の中のプレビュー（MCP App）に表示される.*out\/ の HTML を読んだり、ほかのツールで会話に出したりしない/], ["claude-code", /Chrome で開いてもらう（AI はブラウザーを起動しない）$/]]) {
    const root = makeWorkspace();
    const conn = makeConn();
    const set = core.loadConnections(conn.file, { workspaceRoots: [root], env: {} });
    const dir = path.join(root, "kintone", "dev", "3740-見積書");
    core.ensureAppFolder(dir, core.pickProfile(set, "dev"), 3740);
    writeFileSync(path.join(dir, "fields.json"), FIELDS_TEXT);
    mkdirSync(path.join(dir, "records"));
    writeFileSync(path.join(dir, "records", "3.json"), RECORD_TEXT);
    writeFileSync(path.join(dir, "見積書.json"), settings());
    const s = surface === "desktop" ? await connectDesktop(root, connEnv(conn.file)) : await connectClaudeCode([root], connEnv(conn.file));
    try {
      const r = sc(await s.call("pcraft_preview", { ...(surface === "desktop" ? {} : { workspaceId: root }), path: "kintone/dev/3740-見積書/見積書.json", record: "3" }));
      assert.equal(r.status, "ok", JSON.stringify(r));
      assert.match(r.result.note, re, surface);
    } finally {
      await s.close();
      conn.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  }
});
