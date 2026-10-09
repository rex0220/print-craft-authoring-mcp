// kintone に接続するツール（実装案 5.1、5.4、6.4）: pcraft_fields、pcraft_record、Desktop だけの kintone_get_app / kintone_list_records。
// kintone は test/mock-fetch.mjs の偽物（Node の --import）。GET だけ、値を返さない、秘密の値・kintone のサーバーの文を返さない、
// environments.json の環境（envFile だけから認証、本番・未分類は保存しない）を確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SECRET, SKIP as skip, ZIP, connectClaudeCode, connectDesktop, makeWorkspace, sc, settings } from "./helpers.mjs";

const VALUES = ["□□□□株式会社", "S-0000003", "山田太郎", "月額費用", "kintone ワイドコース", "DESCRIPTION-SECRET", "SERVER-SECRET-MESSAGE"];
const ENV = (log) => ({ PCRAFT_PLUGIN_ZIP: ZIP, KINTONE_BASE_URL: "https://x.cybozu.com", KINTONE_API_TOKEN: SECRET, PCRAFT_TEST_FETCH_LOG: log });

function logFile() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-fetchlog-")));
  return { file: path.join(dir, "fetch.log"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const requests = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const noValues = (s) => VALUES.filter((v) => s.includes(v));

test("pcraft_fields: 項目定義を fields/<番号>.json に保存し、1 項目 1 行の要約を返す。GET だけ・API トークンで", { skip }, async () => {
  const root = makeWorkspace();
  const log = logFile();
  const s = await connectClaudeCode([root], ENV(log.file), { mockFetch: true });
  try {
    const r = sc(await s.call("pcraft_fields", { workspaceId: root, app: 3740 }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.deepEqual([r.result.path, r.result.appId, r.result.appName, r.result.auth], ["fields/3740.json", 3740, "見積書(印刷屋)", "API トークン"]);
    assert.match(r.result.summary, /見積明細/);
    const saved = JSON.parse(readFileSync(path.join(root, "fields", "3740.json"), "utf8"));
    assert.equal(saved.appId, 3740);
    const reqs = requests(log.file);
    assert.deepEqual(reqs.map((q) => q.path), ["/k/v1/app.json", "/k/v1/app/form/fields.json", "/k/v1/app/form/layout.json"]);
    assert.ok(reqs.every((q) => q.method === "GET" && q.hasToken && q.host === "x.cybozu.com"));
    assert.deepEqual(noValues(s.output()), []);
    assert.ok(!s.output().includes(SECRET));
    const nf = sc(await s.call("pcraft_fields", { workspaceId: root, app: 9999 }));
    assert.deepEqual([nf.status, nf.error.code], ["failed", "RestError"]);
    assert.match(nf.error.message, /HTTP 404 GAIA_AP01/);
    assert.ok(!JSON.stringify(nf).includes("SERVER-SECRET-MESSAGE"), "kintone のサーバーの文は返さない");
    const byName = sc(await s.call("pcraft_fields", { workspaceId: root, app: "見積書" }));
    assert.deepEqual([byName.status, byName.error.code], ["invalid", "InputError"], "environments.json が無ければ名前で指定できない");
  } finally {
    await s.close();
    log.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pcraft_record: records/ に保存し、形だけを返す（値は返さない）。fieldsFrom で使う項目だけに絞る", { skip }, async () => {
  const root = makeWorkspace();
  const log = logFile();
  const s = await connectClaudeCode([root], ENV(log.file), { mockFetch: true });
  try {
    const r = sc(await s.call("pcraft_record", { workspaceId: root, app: 3740, id: 3 }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.equal(r.result.path, "records/3740-3.json");
    assert.match(r.result.shape, /見積明細  SUBTABLE  2 行/);
    assert.deepEqual(noValues(JSON.stringify(r)), [], "値を返さない");
    assert.equal(JSON.parse(readFileSync(path.join(root, "records", "3740-3.json"), "utf8")).record.宛名.value, "□□□□株式会社 <b>&\"'</b>", "ファイルには値がある（preview の入力）");
    const saved = sc(await s.call("pcraft_save_settings", { workspaceId: root, path: "settings/見積書.json", content: settings(), fields: "fields/3740.json", expectedAbsent: true }));
    assert.equal(saved.status, "ok");
    const narrowed = sc(await s.call("pcraft_record", { workspaceId: root, app: 3740, id: 3, fieldsFrom: "settings/見積書.json" }));
    assert.equal(narrowed.result.replaced, true);
    const kept = JSON.parse(readFileSync(path.join(root, "records", "3740-3.json"), "utf8"));
    assert.ok(kept.keptFields.length > 0 && !("担当者" in kept.record), "設定が使わない項目（担当者）は保存しない");
    assert.ok(requests(log.file).every((q) => q.method === "GET"));
    assert.ok(!s.output().includes(SECRET));
  } finally {
    await s.close();
    log.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("environments.json: 名前でアプリ、envFile だけから認証、アプリのフォルダーに保存。本番は denied、role の無い環境も denied。record はアプリのフォルダーが要る", { skip }, async () => {
  const root = makeWorkspace();
  const log = logFile();
  mkdirSync(path.join(root, "env"));
  writeFileSync(path.join(root, "env", "dev.env"), "KINTONE_BASE_URL=https://dev-x.cybozu.com\nKINTONE_API_TOKEN=dev-token\n");
  writeFileSync(path.join(root, "env", "prod.env"), "KINTONE_BASE_URL=https://x.cybozu.com\nKINTONE_API_TOKEN=prod-token\n");
  writeFileSync(
    path.join(root, "environments.json"),
    JSON.stringify({ default: "dev", environments: { dev: { baseUrl: "https://dev-x.cybozu.com", envFile: "env/dev.env", role: "development" }, prod: { baseUrl: "https://x.cybozu.com", envFile: "env/prod.env", role: "production" } }, apps: [{ name: "見積書", dev: 101, prod: 3740 }] })
  );
  // 設定項目の接続先（OS の環境変数）は environments.json があるときは使わない
  const s = await connectClaudeCode([root], { ...ENV(log.file), KINTONE_BASE_URL: "https://other.cybozu.com" }, { mockFetch: true });
  try {
    const noFolder = sc(await s.call("pcraft_record", { workspaceId: root, app: "見積書", id: 3 }));
    assert.deepEqual([noFolder.status, noFolder.error.code], ["invalid", "InputError"]);
    assert.match(noFolder.error.message, /先に pcraft_fields/);
    const dev = sc(await s.call("pcraft_fields", { workspaceId: root, app: "見積書" }));
    assert.equal(dev.status, "ok", JSON.stringify(dev));
    assert.equal(dev.result.path, "kintone/dev-x.cybozu.com/101-見積書(印刷屋)/fields.json");
    assert.ok(requests(log.file).every((q) => q.host === "dev-x.cybozu.com"), "envFile の接続先だけ");
    const rec = sc(await s.call("pcraft_record", { workspaceId: root, app: "見積書", id: 3 }));
    assert.deepEqual([rec.status, rec.result.path], ["ok", "kintone/dev-x.cybozu.com/101-見積書(印刷屋)/records/3.json"]);
    const prod = sc(await s.call("pcraft_fields", { workspaceId: root, app: "見積書", env: "prod" }));
    assert.deepEqual([prod.status, prod.error.code], ["denied", "PermissionError"], "本番の項目定義は保存しない（4.2 の P7）");
    assert.ok(!existsSync(path.join(root, "kintone", "x.cybozu.com", "3740-見積書(印刷屋)", "fields.json")));
    const unknown = sc(await s.call("pcraft_fields", { workspaceId: root, app: "見積書", env: "stage" }));
    assert.deepEqual([unknown.status, unknown.error.code], ["invalid", "WorkspaceError"], "知らない環境の名前は入力の誤り（Codex の B1 レビュー MINOR 1）");
    writeFileSync(path.join(root, "environments.json"), JSON.stringify({ environments: { dev: { baseUrl: "https://dev-x.cybozu.com", envFile: "env/dev.env" } }, apps: [{ name: "見積書", dev: 101 }] }));
    const unclassified = sc(await s.call("pcraft_fields", { workspaceId: root, app: "見積書" }));
    assert.deepEqual([unclassified.status, unclassified.error.code], ["denied", "PermissionError"]);
    assert.match(unclassified.error.message, /role が無い/);
    assert.ok(!s.output().includes("dev-token") && !s.output().includes("prod-token"));
  } finally {
    await s.close();
    log.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop の kintone_get_app: 番号か同じオリジンの URL。決めた項目だけ（作成者・説明は返さない）。別のオリジン・ユーザー名の部分は断る", { skip }, async () => {
  const root = makeWorkspace();
  const log = logFile();
  const s = await connectDesktop(root, ENV(log.file), { mockFetch: true });
  try {
    const { tools } = await s.client.listTools();
    assert.ok(tools.some((t) => t.name === "kintone_get_app") && tools.some((t) => t.name === "kintone_list_records"));
    const byId = sc(await s.call("kintone_get_app", { app: 3740 }));
    assert.equal(byId.status, "ok", JSON.stringify(byId));
    assert.deepEqual(Object.keys(byId.result).sort(), ["appId", "baseUrl", "code", "name", "spaceId", "threadId"]);
    assert.deepEqual([byId.result.appId, byId.result.name], [3740, "見積書(印刷屋)"]);
    assert.deepEqual(noValues(JSON.stringify(byId)), []);
    const byUrl = sc(await s.call("kintone_get_app", { app: "https://x.cybozu.com/k/guest/7/3740/?q=1#x" }));
    assert.deepEqual([byUrl.status, byUrl.result.guestSpaceId, byUrl.result.spaceId], ["ok", 7, "11"]);
    assert.equal(requests(log.file).at(-1).path, "/k/guest/7/v1/app.json");
    for (const app of ["https://other.cybozu.com/k/3740/", "https://u:p@x.cybozu.com/k/3740/", "http://x.cybozu.com/k/3740/", "https://x.cybozu.com/k/3740/show#record=1", "見積書"]) {
      const r = sc(await s.call("kintone_get_app", { app }));
      assert.deepEqual([r.status, r.error.code], ["invalid", "InputError"], app);
    }
  } finally {
    await s.close();
    log.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop の kintone_list_records: 5 件まで、形だけ（値は返さない）。limit / offset は断る。Claude Code には kintone_* を出さない", { skip }, async () => {
  const root = makeWorkspace();
  const log = logFile();
  const s = await connectDesktop(root, ENV(log.file), { mockFetch: true });
  try {
    const r = sc(await s.call("kintone_list_records", { app: 3740, query: '見積番号 like "S-" order by $id desc' }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.equal(r.result.records.length, 5, "サーバーが 6 件返しても 5 件まで");
    assert.match(r.result.query, /limit 5$/);
    assert.deepEqual(noValues(JSON.stringify(r)), []);
    const bad = sc(await s.call("kintone_list_records", { app: 3740, query: "order by $id desc limit 100" }));
    assert.deepEqual([bad.status, bad.error.code], ["invalid", "QueryError"]);
    assert.ok(requests(log.file).every((q) => q.method === "GET"));
    assert.ok(!s.output().includes(SECRET));
  } finally {
    await s.close();
    log.cleanup();
  }
  const c = await connectClaudeCode([root], ENV(log.file), { mockFetch: true });
  try {
    const { tools } = await c.client.listTools();
    assert.ok(!tools.some((t) => t.name.startsWith("kintone_")), "Claude Code では公式の kintone MCP を使う（同じことをするツールを出さない）");
  } finally {
    await c.close();
    rmSync(root, { recursive: true, force: true });
  }
});
