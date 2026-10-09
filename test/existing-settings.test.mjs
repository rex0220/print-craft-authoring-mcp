// 既存の設定を扱うツール（実装案 5.1、5.3）: pcraft_buttons（一覧・中身・digest）、pcraft_update_button（digest の照合、差し替え・追加）、
// pcraft_normalize（書き換えない検査、check）、pcraft_preview（out/ に書き、HTML は返さない。アプリのフォルダーの設定はそのフォルダーの out/）
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { FIELDS_TEXT, SKIP as skip, connEnv, connectClaudeCode, makeConn, makeWorkspace, saveInput, sc, settings } from "./helpers.mjs";

const RECORD_TEXT = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "record-3740-3.json"), "utf8");
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const button = (overrides = {}) => JSON.stringify({ ...JSON.parse(settings()).pluginInfos[0], ...overrides });

/** settings/見積書.json を保存した作業フォルダー（records/ にレコード） */
async function prepared(s, root) {
  const r = await s.call("pcraft_save_settings", saveInput(root, "settings/見積書.json"));
  assert.equal(sc(r).status, "ok", JSON.stringify(sc(r)));
  mkdirSync(path.join(root, "records"));
  writeFileSync(path.join(root, "records", "3740-3.json"), RECORD_TEXT);
  return sc(r).digest;
}

test("pcraft_buttons: 一覧・ボタンの中身・digest（ファイルのバイト列）。設定ファイルそのものは返さない。印刷屋の設定でない・.env・外は断る", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    await prepared(s, root);
    const file = path.join(root, "settings", "見積書.json");
    const list = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/見積書.json" }));
    assert.equal(list.status, "ok");
    assert.deepEqual(list.result.menus, ["見積書"]);
    assert.equal(list.digest, sha(file));
    assert.match(list.result.text, /見積書/);
    assert.ok(!list.result.text.includes(readFileSync(file, "utf8").slice(0, 200)), "ファイルの中身そのものは返さない");
    const one = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/見積書.json", button: "見積書" }));
    assert.match(one.result.text, /rex0220-pcraft-page/, "ボタンの HTML");
    const missing = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/見積書.json", button: "無い" }));
    assert.deepEqual([missing.status, missing.error.code], ["invalid", "ButtonNotFoundError"]);
    const notSettings = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "records/3740-3.json" }));
    assert.deepEqual([notSettings.status, notSettings.error.code], ["invalid", "InputError"]);
    assert.match(notSettings.error.message, /印刷屋の設定のファイルではない/);
    assert.ok(!JSON.stringify(notSettings).includes("□□□□株式会社"), "レコードの値を返さない");
    writeFileSync(path.join(root, ".env"), "KINTONE_API_TOKEN=x\n");
    assert.equal(sc(await s.call("pcraft_buttons", { workspaceId: root, path: ".env" })).status, "denied");
    assert.equal(sc(await s.call("pcraft_buttons", { workspaceId: root, path: "../x.json" })).status, "denied");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pcraft_update_button: buttons の digest で差し替え・追加。古い digest は conflict、menu が違えば invalid、ダウンロードの名前は denied", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    const first = await prepared(s, root);
    const file = path.join(root, "settings", "見積書.json");
    const upd = sc(await s.call("pcraft_update_button", { workspaceId: root, path: "settings/見積書.json", button: "見積書", expectedDigest: first, replacement: button({ desc: "見積書の PDF を作ります" }), fields: "fields/3740.json" }));
    assert.equal(upd.status, "ok", JSON.stringify(upd));
    assert.equal(upd.digest, sha(file));
    assert.equal(JSON.parse(readFileSync(file, "utf8")).pluginInfos[0].desc, "見積書の PDF を作ります");
    const stale = sc(await s.call("pcraft_update_button", { workspaceId: root, path: "settings/見積書.json", button: "見積書", expectedDigest: first, replacement: button(), fields: "fields/3740.json" }));
    assert.deepEqual([stale.status, stale.error.code], ["conflict", "ConflictError"]);
    const mismatch = sc(await s.call("pcraft_update_button", { workspaceId: root, path: "settings/見積書.json", button: "見積書", expectedDigest: upd.digest, replacement: button({ menu: "別" }), fields: "fields/3740.json" }));
    assert.equal(mismatch.status, "invalid");
    const added = sc(await s.call("pcraft_update_button", { workspaceId: root, path: "settings/見積書.json", button: "請求書", expectedDigest: upd.digest, replacement: button({ menu: "請求書" }), fields: "fields/3740.json" }));
    assert.equal(added.status, "ok", JSON.stringify(added));
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).pluginInfos.map((b) => b.menu), ["見積書", "請求書"]);
    writeFileSync(path.join(root, "settings", "rex0220-print-craft-app3740-20261005-125115.json"), settings());
    const snap = sc(await s.call("pcraft_update_button", { workspaceId: root, path: "settings/rex0220-print-craft-app3740-20261005-125115.json", button: "見積書", expectedDigest: sha(path.join(root, "settings", "rex0220-print-craft-app3740-20261005-125115.json")), replacement: button(), fields: "fields/3740.json" }));
    assert.equal(snap.status, "denied");
    const badDigest = await s.call("pcraft_update_button", { workspaceId: root, path: "settings/見積書.json", button: "見積書", expectedDigest: "xyz", replacement: button(), fields: "fields/3740.json" });
    assert.equal(badDigest.isError, true, "digest の形はスキーマで確かめる");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pcraft_normalize: 書き換えない。警告を返す。check で派生値の差を返す。エラーは invalid、項目定義が無ければ invalid", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    const digest = await prepared(s, root);
    const file = path.join(root, "settings", "見積書.json");
    const r = sc(await s.call("pcraft_normalize", { workspaceId: root, path: "settings/見積書.json", fields: "fields/3740.json", check: true }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.ok(r.findings.some((f) => f.level === "warning"));
    assert.equal(r.result.checkDiffs.count, 0, "保存したばかりの設定の派生値は一致");
    assert.equal(sha(file), digest, "検査はファイルを書き換えない");
    writeFileSync(path.join(root, "settings", "壊れた.json"), settings({ pluginInfos: [{ ...JSON.parse(button()), tagsInfo: { ...JSON.parse(button()).tagsInfo, pageSize: "X9" } }] }));
    const bad = sc(await s.call("pcraft_normalize", { workspaceId: root, path: "settings/壊れた.json", fields: "fields/3740.json" }));
    assert.deepEqual([bad.status, bad.error.code], ["invalid", "NormalizeError"]);
    assert.ok(bad.findings.some((f) => f.level === "error" && /pageSize/.test(f.rule)));
    const noFields = sc(await s.call("pcraft_normalize", { workspaceId: root, path: "settings/見積書.json" }));
    assert.deepEqual([noFields.status, noFields.error.code], ["invalid", "InputError"]);
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pcraft_preview: out/ に書き、ページ数を返す（HTML とレコードの値は返さない）。設定にエラーがあれば書かない。アプリのフォルダーの設定は同じフォルダーの fields.json・records/3.json・out/", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const s = await connectClaudeCode([root], connEnv(conn.file));
  try {
    await prepared(s, root);
    const r = await s.call("pcraft_preview", { workspaceId: root, path: "settings/見積書.json", record: "records/3740-3.json", fields: "fields/3740.json" });
    assert.equal(sc(r).status, "ok", JSON.stringify(sc(r)));
    const [b] = sc(r).result.results;
    assert.deepEqual([b.menu, b.pages], ["見積書", 1]);
    assert.ok(!("fileName" in b), "ファイル名（$fname をレコードで評価したもの）は返さない（Codex の B1 レビュー BLOCKER 2）");
    assert.ok(!JSON.stringify(r).includes("S-0000003"), "ファイル名に入るレコードの値（見積番号）を返さない");
    assert.ok(existsSync(path.join(root, b.file)) && b.file.startsWith("out/"), b.file);
    assert.ok(!JSON.stringify(r).includes("□□□□株式会社") && !JSON.stringify(r).includes("<html"), "HTML とレコードの値は返さない");
    writeFileSync(path.join(root, "settings", "壊れた.json"), settings({ pluginInfos: [{ ...JSON.parse(button()), menu: "壊れた", tagsInfo: { ...JSON.parse(button()).tagsInfo, pageSize: "X9" } }] }));
    const bad = sc(await s.call("pcraft_preview", { workspaceId: root, path: "settings/壊れた.json", record: "records/3740-3.json", fields: "fields/3740.json" }));
    assert.equal(bad.status, "invalid");
    assert.ok(!readdirSync(path.join(root, "out")).some((n) => n.includes("壊れた")), "エラーがあれば書かない");

    assert.equal(sc(r).result.trustedOrigin, "dev-x.cybozu.com", "settings/ は既定の profile の接続先");

    // アプリのフォルダー（印は中核が作る。prod の profile。本番の保護は無い。15.1 の 3）
    const set = core.loadConnections(conn.file, { workspaceRoots: [root], env: {} });
    const prodDir = path.join(root, "kintone", "prod", "3740-見積書");
    core.ensureAppFolder(prodDir, core.pickProfile(set, "prod"), 3740);
    mkdirSync(path.join(prodDir, "records"), { recursive: true });
    writeFileSync(path.join(prodDir, "fields.json"), FIELDS_TEXT);
    writeFileSync(path.join(prodDir, "records", "3.json"), RECORD_TEXT);
    writeFileSync(path.join(prodDir, "rex0220-print-craft-app3740-20261005-125115.json"), settings({ pluginInfos: [{ ...JSON.parse(button()), menu: "本番の見積書" }] }));
    const prod = sc(await s.call("pcraft_preview", { workspaceId: root, path: "kintone/prod/3740-見積書/rex0220-print-craft-app3740-20261005-125115.json", record: "3" }));
    assert.equal(prod.status, "ok", JSON.stringify(prod));
    assert.match(prod.result.results[0].file, /^kintone\/prod\/3740-見積書\/out\//, "アプリのフォルダーの out/");
    assert.equal(prod.result.trustedOrigin, "x.cybozu.com", "アプリのフォルダーはその profile の接続先");
    const noRecord = sc(await s.call("pcraft_preview", { workspaceId: root, path: "kintone/prod/3740-見積書/rex0220-print-craft-app3740-20261005-125115.json", record: "4" }));
    assert.deepEqual([noRecord.status, noRecord.error.code], ["invalid", "InputError"]);
    assert.match(noRecord.error.message, /pcraft_record で取る/);
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
