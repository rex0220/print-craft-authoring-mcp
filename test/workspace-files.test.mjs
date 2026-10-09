// 作業フォルダーのファイルを扱うツールと pull（実装案 5.1 の最後の行、15.8）: pcraft_files、pcraft_take、pcraft_edit、pcraft_diff、pcraft_pull。
// kintone は test/mock-fetch.mjs の偽物。プラグインの設定は、この試験が中核（印刷屋の zip の writeConfig）で保存の形にしてファイルに置く。
// アプリのフォルダー（kintone/<profile>/<番号>-<アプリ名>/）を使うのは、kintone の接続のファイルがあるときだけ
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { FIELDS_TEXT, SETTINGS_TEXT, SKIP as skip, ZIP, connEnv, connectClaudeCode, connectDesktop, leakedTokens, makeConn, makeWorkspace, saveInput, sc } from "./helpers.mjs";

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const tmp = skip ? null : realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-pluginconfig-")));
const CONFIG = tmp ? path.join(tmp, "plugin-config.json") : "";
if (!skip) {
  // 設定画面が保存した形（kit の writeConfig の圧縮形式 + shell の共通項目）。tools の pull の試験と同じ作り方
  const engine = await core.loadEngine({ pluginZip: ZIP });
  const r = await core.normalizeSettings({ settingsText: SETTINGS_TEXT, settingsFile: "settings/a.json", fields: JSON.parse(FIELDS_TEXT), engine });
  const { date, pluginName, pluginID, PluginVersion, appId, appName, ...body } = r.output;
  const stored = await engine.api.writeConfig({ ...body, pluginLastUpdate: "2026-10-05 10:00:00", pluginUpdater: "佐藤", pluginProductEnv: true }, "compressed");
  writeFileSync(CONFIG, JSON.stringify(stored));
}
const DEV_DIR = "kintone/dev/3740-見積書(印刷屋)";
const SNAP = /^rex0220-print-craft-app3740-\d{8}-\d{6}\.json$/;

test("接続のファイルが無い作業フォルダー: pcraft_files は settings/ などの名前だけ、pcraft_diff は差。pull・take・edit と files の app / profile は not-configured", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root], { PCRAFT_PLUGIN_ZIP: ZIP, PCRAFT_TEST_PLUGIN_CONFIG: CONFIG }, { mockFetch: true });
  try {
    assert.equal(sc(await s.call("pcraft_save_settings", saveInput(root, "settings/見積書.json"))).status, "ok");
    const changed = JSON.stringify({ ...JSON.parse(SETTINGS_TEXT), pluginInfos: [{ ...JSON.parse(SETTINGS_TEXT).pluginInfos[0], desc: "直した説明" }] });
    assert.equal(sc(await s.call("pcraft_save_settings", saveInput(root, "settings/見積書-直した.json", changed))).status, "ok");
    const files = sc(await s.call("pcraft_files", { workspaceId: root }));
    assert.equal(files.status, "ok");
    assert.equal(files.result.mode, "not-configured");
    assert.deepEqual(files.result.files.settings.sort(), ["settings/見積書-直した.json", "settings/見積書.json"]);
    assert.deepEqual(files.result.files.fields, ["fields/3740.json"]);
    assert.ok(!("profiles" in files.result));
    assert.ok(!JSON.stringify(files).includes("rex0220-pcraft-page"), "中身は返さない");
    const d = sc(await s.call("pcraft_diff", { workspaceId: root, before: "settings/見積書.json", after: "settings/見積書-直した.json" }));
    assert.equal(d.status, "ok");
    assert.match(d.result.text, /直した説明/);
    for (const [tool, input] of [["pcraft_pull", { app: 3740 }], ["pcraft_take", {}], ["pcraft_edit", { app: 3740 }], ["pcraft_files", { app: 3740 }], ["pcraft_files", { profile: "dev" }]]) {
      const r = sc(await s.call(tool, { workspaceId: root, ...input }));
      assert.deepEqual([r.status, r.error?.code], ["failed", "not-configured"], `${tool} ${JSON.stringify(input)}`);
    }
    assert.ok(!existsSync(path.join(root, "kintone")));
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("接続のファイル: pull はアプリのフォルダーにダウンロードと同じ名前（無ければ印を置いて作る）、files は profile ごとのフォルダーと印の状態・app で新しい順、edit は -edit.json（prod も）、take は inbox から名前のまま（profile の選び方）", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const s = await connectClaudeCode([root], connEnv(conn.file, { PCRAFT_TEST_PLUGIN_CONFIG: CONFIG }), { mockFetch: true });
  try {
    const p = sc(await s.call("pcraft_pull", { workspaceId: root, app: 3740 }));
    assert.equal(p.status, "ok", JSON.stringify(p));
    assert.equal(path.dirname(p.result.path), DEV_DIR);
    assert.match(path.basename(p.result.path), SNAP);
    assert.deepEqual([p.result.menus, p.result.profile], [["見積書"], "dev"]);
    assert.equal(p.digest, sha(path.join(root, p.result.path)));
    assert.match(p.result.buttons, /見積書/);
    assert.equal(JSON.parse(readFileSync(path.join(root, DEV_DIR, ".pcraft-app.json"), "utf8")).profile, "dev", "pull が作ったフォルダーにも印");

    const all = sc(await s.call("pcraft_files", { workspaceId: root }));
    assert.equal(all.result.mode, "profiles");
    assert.deepEqual(all.result.profiles.find((x) => x.name === "dev"), { name: "dev", host: "dev-x.cybozu.com", folders: [{ name: "3740-見積書(印刷屋)", appId: 3740, mark: "ok" }] });
    assert.ok(!JSON.stringify(all).includes(path.basename(p.result.path)), "app を付けなければアプリのフォルダーの中は一覧しない");
    const f = sc(await s.call("pcraft_files", { workspaceId: root, app: 3740 }));
    assert.deepEqual([f.status, f.result.current, f.result.fields, f.result.folder, f.result.profile.name], ["ok", path.basename(p.result.path), false, DEV_DIR, "dev"]);

    const e = sc(await s.call("pcraft_edit", { workspaceId: root, app: 3740 }));
    assert.equal(e.status, "ok", JSON.stringify(e));
    assert.match(e.result.path, /-edit\.json$/);
    assert.equal(e.result.existed, false);
    assert.equal(readFileSync(path.join(root, e.result.path), "utf8"), readFileSync(path.join(root, p.result.path), "utf8"));
    assert.equal(sc(await s.call("pcraft_edit", { workspaceId: root, app: 3740 })).result.existed, true, "既にあればそのまま（上書きしない）");
    const notSnap = sc(await s.call("pcraft_edit", { workspaceId: root, path: e.result.path }));
    assert.deepEqual([notSnap.status, notSnap.error.code], ["invalid", "InputError"]);
    const otherProfile = sc(await s.call("pcraft_edit", { workspaceId: root, path: p.result.path, profile: "prod" }));
    assert.deepEqual([otherProfile.status, otherProfile.error.code], ["invalid", "InputError"], "パスの profile と引数が違う");
    const d = sc(await s.call("pcraft_diff", { workspaceId: root, before: p.result.path, after: e.result.path }));
    assert.equal(d.status, "ok", JSON.stringify(d));

    // prod: pull も edit もできる（本番の保護は無い。15.1 の 3）
    const prodPull = sc(await s.call("pcraft_pull", { workspaceId: root, app: 3740, profile: "prod" }));
    assert.equal(prodPull.status, "ok", JSON.stringify(prodPull));
    assert.equal(path.dirname(prodPull.result.path), "kintone/prod/3740-見積書(印刷屋)");
    assert.equal(sc(await s.call("pcraft_edit", { workspaceId: root, path: prodPull.result.path })).status, "ok");

    // take: inbox のダウンロードを名前のまま。行き先は profile の選び方（引数、無ければ defaultProfile）
    mkdirSync(path.join(root, "inbox"));
    const dl = "rex0220-print-craft-app3740-20261001-090000.json";
    writeFileSync(path.join(root, "inbox", dl), readFileSync(path.join(root, p.result.path)));
    const t = sc(await s.call("pcraft_take", { workspaceId: root }));
    assert.equal(t.status, "ok", JSON.stringify(t));
    assert.deepEqual(t.result.moved.map((m) => m.to.replace(/\\/g, "/")), [`${DEV_DIR}/${dl}`]);
    assert.deepEqual(readdirSync(path.join(root, "inbox")), []);
    const f2 = sc(await s.call("pcraft_files", { workspaceId: root, app: 3740 }));
    assert.deepEqual(f2.result.snapshots, [path.basename(p.result.path), dl], "新しい順（先頭が今の設定）");
    const dl2 = "rex0220-print-craft-app3740-20261002-090000.json";
    writeFileSync(path.join(root, "inbox", dl2), readFileSync(path.join(root, p.result.path)));
    const t2 = sc(await s.call("pcraft_take", { workspaceId: root, profile: "prod" }));
    assert.deepEqual(t2.result.moved.map((m) => m.to.replace(/\\/g, "/")), [`kintone/prod/3740-見積書(印刷屋)/${dl2}`]);
    assert.deepEqual(leakedTokens(s.output()), []);
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop の pcraft_pull は運用環境だけ（preview の引数は無い）", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const s = await connectDesktop(root, connEnv(conn.file, { PCRAFT_TEST_PLUGIN_CONFIG: CONFIG }), { mockFetch: true });
  try {
    const pull = (await s.client.listTools()).tools.find((t) => t.name === "pcraft_pull");
    assert.ok(!("preview" in pull.inputSchema.properties));
    const r = await s.call("pcraft_pull", { app: 3740, preview: true });
    assert.equal(r.isError, true);
    assert.equal(sc(await s.call("pcraft_pull", { app: 3740 })).status, "ok");
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test.after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});
