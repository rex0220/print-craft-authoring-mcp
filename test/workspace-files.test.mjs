// 作業フォルダーのファイルを扱うツールと pull（実装案 5.1 の最後の行）: pcraft_files、pcraft_take、pcraft_edit、pcraft_diff、pcraft_pull。
// kintone は test/mock-fetch.mjs の偽物。プラグインの設定は、この試験が中核（印刷屋の zip の writeConfig）で保存の形にしてファイルに置く
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { FIELDS_TEXT, SETTINGS_TEXT, SKIP as skip, ZIP, connectClaudeCode, connectDesktop, makeWorkspace, saveInput, sc } from "./helpers.mjs";

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
const ENV = { PCRAFT_PLUGIN_ZIP: ZIP, KINTONE_BASE_URL: "https://x.cybozu.com", KINTONE_API_TOKEN: "test-token", PCRAFT_TEST_PLUGIN_CONFIG: CONFIG };

function devWorkspace() {
  const root = makeWorkspace();
  mkdirSync(path.join(root, "env"));
  writeFileSync(path.join(root, "env", "dev.env"), "KINTONE_BASE_URL=https://dev-x.cybozu.com\nKINTONE_API_TOKEN=dev-token\n");
  writeFileSync(path.join(root, "env", "prod.env"), "KINTONE_BASE_URL=https://x.cybozu.com\nKINTONE_API_TOKEN=prod-token\n");
  writeFileSync(
    path.join(root, "environments.json"),
    JSON.stringify({ default: "dev", environments: { dev: { baseUrl: "https://dev-x.cybozu.com", envFile: "env/dev.env", role: "development" }, prod: { baseUrl: "https://x.cybozu.com", envFile: "env/prod.env", role: "production" } }, apps: [{ name: "見積書", dev: 101, prod: 3740 }] })
  );
  return root;
}

test("environments.json が無い作業フォルダー: pcraft_pull は settings/ に新しく置く（上書きしない）、pcraft_files は名前だけ、pcraft_diff は差", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root], ENV, { mockFetch: true });
  try {
    const p = sc(await s.call("pcraft_pull", { workspaceId: root, app: 3740 }));
    assert.equal(p.status, "ok", JSON.stringify(p));
    assert.match(p.result.path, /^settings\/APP3740-.+\.json$/);
    assert.deepEqual(p.result.menus, ["見積書"]);
    assert.equal(p.digest, sha(path.join(root, p.result.path)));
    assert.match(p.result.buttons, /見積書/);
    const again = sc(await s.call("pcraft_pull", { workspaceId: root, app: 3740 }));
    assert.deepEqual([again.status, again.error.code], ["conflict", "ConflictError"], "上書きしない");
    const saved = sc(await s.call("pcraft_save_settings", saveInput(root, "settings/見積書-直した.json", JSON.stringify({ ...JSON.parse(SETTINGS_TEXT), pluginInfos: [{ ...JSON.parse(SETTINGS_TEXT).pluginInfos[0], desc: "直した説明" }] }))));
    assert.equal(saved.status, "ok");
    const files = sc(await s.call("pcraft_files", { workspaceId: root }));
    assert.equal(files.status, "ok");
    assert.deepEqual(files.result.files.settings.sort(), [p.result.path, "settings/見積書-直した.json"].sort());
    assert.deepEqual(files.result.files.fields, ["fields/3740.json"]);
    assert.ok(!JSON.stringify(files).includes("rex0220-pcraft-page"), "中身は返さない");
    const d = sc(await s.call("pcraft_diff", { workspaceId: root, before: p.result.path, after: "settings/見積書-直した.json" }));
    assert.equal(d.status, "ok");
    assert.match(d.result.text, /直した説明/);
    const missing = sc(await s.call("pcraft_pull", { workspaceId: root, app: 9999 }));
    assert.equal(missing.status, "failed");
    for (const t of ["pcraft_take", "pcraft_edit"]) {
      const r = sc(await s.call(t, { workspaceId: root }));
      assert.deepEqual([r.status, r.error.code], ["invalid", "InputError"], `${t} は environments.json があるときだけ`);
    }
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("environments.json: pull は アプリのフォルダーにダウンロードと同じ名前、files は新しい順、edit は -edit.json（本番は denied）、take は inbox から名前のまま", { skip }, async () => {
  const root = devWorkspace();
  const s = await connectClaudeCode([root], ENV, { mockFetch: true });
  try {
    assert.equal(sc(await s.call("pcraft_fields", { workspaceId: root, app: "見積書" })).status, "ok");
    const p = sc(await s.call("pcraft_pull", { workspaceId: root, app: "見積書" }));
    assert.equal(p.status, "ok", JSON.stringify(p));
    assert.match(p.result.path, /^kintone\/dev-x\.cybozu\.com\/101-見積書\(印刷屋\)\/rex0220-print-craft-app101-\d{8}-\d{6}\.json$/);
    const f = sc(await s.call("pcraft_files", { workspaceId: root, app: "見積書" }));
    assert.deepEqual([f.status, f.result.current, f.result.fields, f.result.env.role], ["ok", path.basename(p.result.path), true, "development"]);
    const e = sc(await s.call("pcraft_edit", { workspaceId: root, app: "見積書" }));
    assert.equal(e.status, "ok", JSON.stringify(e));
    assert.match(e.result.path, /-edit\.json$/);
    assert.equal(e.result.existed, false);
    assert.equal(readFileSync(path.join(root, e.result.path), "utf8"), readFileSync(path.join(root, p.result.path), "utf8"));
    assert.equal(sc(await s.call("pcraft_edit", { workspaceId: root, app: "見積書" })).result.existed, true, "既にあればそのまま（上書きしない）");
    const notSnap = sc(await s.call("pcraft_edit", { workspaceId: root, path: e.result.path }));
    assert.deepEqual([notSnap.status, notSnap.error.code], ["invalid", "InputError"]);

    // 本番: pull は新しい名前で足せる。edit（直すための写し）は denied
    const prodPull = sc(await s.call("pcraft_pull", { workspaceId: root, app: "見積書", env: "prod" }));
    assert.equal(prodPull.status, "ok", JSON.stringify(prodPull));
    assert.match(prodPull.result.path, /^kintone\/x\.cybozu\.com\/3740-/);
    const prodEdit = sc(await s.call("pcraft_edit", { workspaceId: root, path: prodPull.result.path }));
    assert.deepEqual([prodEdit.status, prodEdit.error.code], ["denied", "PermissionError"]);
    assert.ok(!existsSync(path.join(root, prodPull.result.path.replace(/\.json$/, "-edit.json"))));

    // take: inbox のダウンロードを名前のまま アプリのフォルダーへ
    mkdirSync(path.join(root, "inbox"));
    const dl = "rex0220-print-craft-app101-20261001-090000.json";
    writeFileSync(path.join(root, "inbox", dl), readFileSync(path.join(root, p.result.path)));
    const t = sc(await s.call("pcraft_take", { workspaceId: root }));
    assert.equal(t.status, "ok", JSON.stringify(t));
    assert.deepEqual(t.result.moved.map((m) => path.basename(m.to)), [dl]);
    assert.deepEqual(readdirSync(path.join(root, "inbox")), []);
    const f2 = sc(await s.call("pcraft_files", { workspaceId: root, app: "見積書" }));
    assert.deepEqual(f2.result.snapshots, [path.basename(p.result.path), dl], "新しい順（先頭が今の設定）");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop の pcraft_pull は運用環境だけ（preview の引数は無い）", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectDesktop(root, ENV, { mockFetch: true });
  try {
    const pull = (await s.client.listTools()).tools.find((t) => t.name === "pcraft_pull");
    assert.ok(!("preview" in pull.inputSchema.properties));
    const r = await s.call("pcraft_pull", { app: 3740, preview: true });
    assert.equal(r.isError, true);
    assert.equal(sc(await s.call("pcraft_pull", { app: 3740 })).status, "ok");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test.after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});
