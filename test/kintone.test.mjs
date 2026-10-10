// kintone に接続するツール（実装案 5.1、5.4、6.4、15 章）: pcraft_fields、pcraft_record、Desktop だけの kintone_get_app / kintone_list_records。
// kintone は test/mock-fetch.mjs の偽物（Node の --import）。接続は kintone の接続のファイル（kSQL の形。作業フォルダーの外）の profile だけ。
// GET だけ、アプリごとのトークン、値を返さない、秘密の値・接続のファイルのパス・kintone のサーバーの文を返さない、接続の誤りの status と code（15.10）を確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONN, SKIP as skip, TOKENS, ZIP, connEnv, connectClaudeCode, connectDesktop, fetchLog, leakedTokens, makeConn, makeWorkspace, sc, settings, tokenHash } from "./helpers.mjs";

const VALUES = ["□□□□株式会社", "S-0000003", "山田太郎", "月額費用", "kintone ワイドコース", "DESCRIPTION-SECRET", "SERVER-SECRET-MESSAGE"];
const noValues = (s) => VALUES.filter((v) => s.includes(v));
const APP_DIR = "kintone/dev/3740-見積書(印刷屋)";

/** 呼び出しの誤りの形（isError、ok、status、code） */
const errorOf = (r) => [r.isError, sc(r).ok, sc(r).status, sc(r).error?.code];

test("pcraft_fields: profile（無ければ defaultProfile）で取り、kintone/<profile>/<番号>-<アプリ名>/fields.json に保存（印を先に置く）。アプリごとのトークン、GET だけ、OS の KINTONE_* は読まない", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const log = fetchLog();
  const s = await connectClaudeCode([root], connEnv(conn.file, { PCRAFT_TEST_FETCH_LOG: log.file }), { mockFetch: true });
  try {
    const r = sc(await s.call("pcraft_fields", { workspaceId: root, app: 3740 }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.deepEqual([r.result.path, r.result.appId, r.result.appName, r.result.profile, r.result.baseUrl], [`${APP_DIR}/fields.json`, 3740, "見積書(印刷屋)", "dev", "https://dev-x.cybozu.com"]);
    assert.match(r.result.auth, /API トークン（profile dev）/);
    assert.match(r.result.summary, /見積明細/);
    const mark = JSON.parse(readFileSync(path.join(root, APP_DIR, ".pcraft-app.json"), "utf8"));
    assert.deepEqual(mark, { schemaVersion: 1, profile: "dev", origin: "https://dev-x.cybozu.com", guestSpaceId: null, appId: 3740 });
    let reqs = log.requests();
    assert.deepEqual(reqs.map((q) => q.path), ["/k/v1/app.json", "/k/v1/app/form/fields.json", "/k/v1/app/form/layout.json"]);
    assert.ok(reqs.every((q) => q.method === "GET" && q.host === "dev-x.cybozu.com" && q.token === tokenHash(TOKENS.dev3740)), "dev の APP3740 のトークンだけ（OS の KINTONE_* は読まない）");
    // アプリ 101 は env: のトークン。profile prod は本番の接続先とトークン（本番の保護は無い。15.1 の 3）
    const r101 = sc(await s.call("pcraft_fields", { workspaceId: root, app: 101 }));
    assert.deepEqual([r101.status, r101.result?.path], ["ok", "kintone/dev/101-見積書(印刷屋)/fields.json"], JSON.stringify(r101));
    const prod = sc(await s.call("pcraft_fields", { workspaceId: root, app: 3740, profile: "prod" }));
    assert.deepEqual([prod.status, prod.result?.path, prod.result?.baseUrl], ["ok", "kintone/prod/3740-見積書(印刷屋)/fields.json", "https://x.cybozu.com"], JSON.stringify(prod));
    reqs = log.requests();
    assert.ok(reqs.filter((q) => q.query.app === "101" || q.query.id === "101").every((q) => q.token === tokenHash(TOKENS.dev101)), "アプリ 101 は env: の変数のトークン");
    assert.ok(reqs.filter((q) => q.host === "x.cybozu.com").every((q) => q.token === tokenHash(TOKENS.prod3740)), "prod のトークン");
    // kintone の誤りは HTTP の状態とエラーコードだけ（サーバーの文は返さない）
    const nf = sc(await s.call("pcraft_fields", { workspaceId: root, app: 9999 }));
    assert.deepEqual([nf.status, nf.error.code], ["failed", "RestError"]);
    assert.match(nf.error.message, /HTTP 404 GAIA_AP01/);
    assert.ok(!JSON.stringify(nf).includes("SERVER-SECRET-MESSAGE"), "kintone のサーバーの文は返さない");
    // 接続の誤り（15.10）: 無い profile は invalid、トークンの無いアプリは failed（送らない）
    const sent = log.requests().length;
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 3740, profile: "stage" })), [true, false, "invalid", "unknown-profile"]);
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 555 })), [true, false, "failed", "no-token"]);
    assert.equal(log.requests().length, sent, "接続の誤りでは kintone に送らない");
    assert.equal((await s.call("pcraft_fields", { workspaceId: root, app: 3740, profile: "../x" })).isError, true, "profile の名前の形はスキーマで確かめる");
    assert.equal((await s.call("pcraft_fields", { workspaceId: root, app: "見積書" })).isError, true, "アプリは番号だけ");
    assert.deepEqual(noValues(s.output()), []);
    assert.deepEqual(leakedTokens(s.output()), []);
    assert.ok(!s.output().includes(conn.file), "接続のファイルのパスを返さない（名前まで）");
  } finally {
    await s.close();
    log.cleanup();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pcraft_record: アプリのフォルダー（pcraft_fields が作る）の records/<番号>.json に保存し、形だけを返す。フォルダーが無ければ送らずに「先に pcraft_fields」。fieldsFrom で使う項目だけに絞る", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const log = fetchLog();
  const s = await connectClaudeCode([root], connEnv(conn.file, { PCRAFT_TEST_FETCH_LOG: log.file }), { mockFetch: true });
  try {
    const before = sc(await s.call("pcraft_record", { workspaceId: root, app: 3740, id: 3 }));
    assert.deepEqual([before.status, before.error.code], ["invalid", "InputError"]);
    assert.match(before.error.message, /先に pcraft_fields/);
    assert.equal(log.requests().length, 0, "フォルダーが無ければ kintone に送らない");
    assert.equal(sc(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })).status, "ok");
    const r = sc(await s.call("pcraft_record", { workspaceId: root, app: 3740, id: 3 }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.deepEqual([r.result.path, r.result.profile], [`${APP_DIR}/records/3.json`, "dev"]);
    assert.match(r.result.shape, /見積明細  SUBTABLE  2 行/);
    assert.deepEqual(noValues(JSON.stringify(r)), [], "値を返さない");
    assert.equal(JSON.parse(readFileSync(path.join(root, APP_DIR, "records", "3.json"), "utf8")).record.宛名.value, "□□□□株式会社 <b>&\"'</b>", "ファイルには値がある（preview の入力）");
    // アプリのフォルダーの設定は同じフォルダーの fields.json で検査する（fields を渡さない）
    const saved = sc(await s.call("pcraft_save_settings", { workspaceId: root, path: `${APP_DIR}/見積書.json`, content: settings(), expectedAbsent: true }));
    assert.equal(saved.status, "ok", JSON.stringify(saved));
    assert.equal(saved.result.trustedOrigin, "dev-x.cybozu.com");
    const narrowed = sc(await s.call("pcraft_record", { workspaceId: root, app: 3740, id: 3, fieldsFrom: `${APP_DIR}/見積書.json` }));
    assert.equal(narrowed.result.replaced, true);
    const kept = JSON.parse(readFileSync(path.join(root, APP_DIR, "records", "3.json"), "utf8"));
    assert.ok(kept.keptFields.length > 0 && !("担当者" in kept.record), "設定が使わない項目（担当者）は保存しない");
    const reqs = log.requests();
    assert.ok(reqs.every((q) => q.method === "GET" && q.token === tokenHash(TOKENS.dev3740)));
    assert.deepEqual(leakedTokens(s.output()), []);
  } finally {
    await s.close();
    log.cleanup();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("接続の誤り（15.10）: 未設定・environments.json が残る・読めない・作業フォルダーの中（symlink も）・既定の profile が無い・profile の誤り・env: の変数が無い・ログイン名とパスワードがそろわない。kintone を使わないツールは動く", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const calls = [];
  const open = async (env) => {
    const s = await connectClaudeCode([root], env, { mockFetch: true });
    calls.push(s);
    return s;
  };
  try {
    // 未設定: kintone を使うツールは failed（not-configured）、保存は動く（iframe の接続先なし）
    let s = await open({ PCRAFT_PLUGIN_ZIP: ZIP });
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })), [true, false, "failed", "not-configured"]);
    const local = sc(await s.call("pcraft_save_settings", { workspaceId: root, path: "settings/a.json", content: settings(), fields: "fields/3740.json", expectedAbsent: true }));
    assert.deepEqual([local.status, local.result.trustedOrigin], ["ok", null], JSON.stringify(local));
    assert.match(local.result.trustedOriginReason, /接続のファイルが設定されていない/);
    const intoKintone = sc(await s.call("pcraft_save_settings", { workspaceId: root, path: "kintone/dev/3740-x/a.json", content: settings(), fields: "fields/3740.json", expectedAbsent: true }));
    assert.deepEqual([intoKintone.status, intoKintone.error.code], ["denied", "PermissionError"], "接続のファイルが無いときは kintone/ の下を使わない");
    // environments.json が残っていて接続のファイルが無い: kintone を使うツールと kintone/ は止まる（failed）、settings/ は動く
    writeFileSync(path.join(root, "environments.json"), JSON.stringify({ environments: { dev: { baseUrl: "https://dev-x.cybozu.com", role: "development" } } }));
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })), [true, false, "failed", "legacy-config-present"]);
    assert.deepEqual(errorOf(await s.call("pcraft_take", { workspaceId: root })), [true, false, "failed", "legacy-config-present"]);
    assert.equal(sc(await s.call("pcraft_save_settings", { workspaceId: root, path: "settings/b.json", content: settings(), fields: "fields/3740.json", expectedAbsent: true })).status, "ok");
    rmSync(path.join(root, "environments.json"));

    // 読めない（壊れた JSON）: 1 接続の形に戻らない。形を決める保存・検査も止まる。buttons は settings/ なら読める（接続のファイルを読まない。15.9 の表）
    conn.write("{ broken");
    s = await open(connEnv(conn.file));
    const broken = sc(await s.call("pcraft_fields", { workspaceId: root, app: 3740 }));
    assert.deepEqual([broken.status, broken.error.code], ["failed", "unreadable"]);
    assert.match(broken.error.message, /ksql\.config\.json/);
    assert.equal(sc(await s.call("pcraft_normalize", { workspaceId: root, path: "settings/a.json", fields: "fields/3740.json" })).error?.code, "unreadable");
    assert.equal(sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/a.json" })).status, "ok");
    conn.write(CONN);

    // 作業フォルダーの中（ファイルそのもの、外を指す symlink）: denied（inside-workspace）
    const inside = path.join(root, "conn.json");
    writeFileSync(inside, JSON.stringify(CONN));
    s = await open(connEnv(inside));
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })), [true, false, "denied", "inside-workspace"]);
    symlinkSync(conn.file, path.join(root, "link.json"));
    s = await open(connEnv(path.join(root, "link.json")));
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })), [true, false, "denied", "inside-workspace"]);

    // env: の変数が無い（アプリ 101）・ログイン名とパスワードがそろわない・既定の profile が無い・使えない profile
    conn.write({
      profiles: {
        prod: CONN.profiles.prod,
        dev2: { baseUrl: "https://dev-x.cybozu.com", tokenMap: { APP101: "env:PCRAFT_TEST_TOKEN_101" } },
        up: { baseUrl: "https://dev-x.cybozu.com", auth: "userpass", username: "print-craft-reader" },
        bad: { baseUrl: "http://dev-x.cybozu.com" }
      }
    });
    s = await open(connEnv(conn.file, { PCRAFT_TEST_TOKEN_101: "" }));
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })), [true, false, "failed", "no-default-profile"]);
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 101, profile: "dev2" })), [true, false, "failed", "env-missing"]);
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 3740, profile: "up" })), [true, false, "failed", "no-userpass"]);
    assert.deepEqual(errorOf(await s.call("pcraft_fields", { workspaceId: root, app: 3740, profile: "bad" })), [true, false, "failed", "profile-invalid"]);
    assert.equal(sc(await s.call("pcraft_fields", { workspaceId: root, app: 3740, profile: "prod" })).status, "ok", "ほかの profile の誤りは使える profile を止めない");
    for (const c of calls) {
      assert.deepEqual(leakedTokens(c.output()), []);
      assert.ok(!c.output().includes(conn.file) && !c.output().includes(conn.dir), "接続のファイルのパスを返さない");
    }
  } finally {
    for (const c of calls) await c.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("アプリのフォルダーの印（15.5）: 別の接続・印の無い・壊れた印のフォルダーは、kintone に送る前・読む前に conflict。接続のファイルに無い profile のフォルダーは denied。印には書けない", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const log = fetchLog();
  const s = await connectClaudeCode([root], connEnv(conn.file, { PCRAFT_TEST_FETCH_LOG: log.file }), { mockFetch: true });
  const conflict = async (tool, input, code) => assert.deepEqual(errorOf(await s.call(tool, { workspaceId: root, ...input })), [true, false, "conflict", code], `${tool} ${JSON.stringify(input)}`);
  try {
    assert.equal(sc(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })).status, "ok");
    assert.equal(sc(await s.call("pcraft_save_settings", { workspaceId: root, path: `${APP_DIR}/見積書.json`, content: settings(), expectedAbsent: true })).status, "ok");
    // 同じ名前の profile の接続先を変えた（印は前の接続のもの）
    conn.write({ ...CONN, profiles: { ...CONN.profiles, dev: { ...CONN.profiles.dev, baseUrl: "https://x.cybozu.com" } } });
    const sent = log.requests().length;
    await conflict("pcraft_fields", { app: 3740 }, "app-identity-conflict");
    await conflict("pcraft_record", { app: 3740, id: 3 }, "app-identity-conflict");
    await conflict("pcraft_normalize", { path: `${APP_DIR}/見積書.json` }, "app-identity-conflict");
    await conflict("pcraft_buttons", { path: `${APP_DIR}/見積書.json` }, "app-identity-conflict");
    await conflict("pcraft_preview", { path: `${APP_DIR}/見積書.json`, record: "3" }, "app-identity-conflict");
    await conflict("pcraft_files", { app: 3740 }, "app-identity-conflict");
    assert.equal(log.requests().length, sent, "印が合わなければ kintone に送らない");
    conn.write(CONN);
    // 印の無いフォルダー（手で作った・古い形）と壊れた印
    const bare = path.join(root, "kintone", "dev", "101-手作り");
    mkdirSync(bare, { recursive: true });
    writeFileSync(path.join(bare, "a.json"), settings());
    await conflict("pcraft_normalize", { path: "kintone/dev/101-手作り/a.json", fields: "fields/3740.json" }, "app-marker-missing");
    await conflict("pcraft_record", { app: 101, id: 3 }, "app-marker-missing");
    await conflict("pcraft_fields", { app: 101 }, "app-marker-missing");
    writeFileSync(path.join(bare, ".pcraft-app.json"), "{ broken");
    await conflict("pcraft_buttons", { path: "kintone/dev/101-手作り/a.json" }, "app-marker-invalid");
    assert.equal(log.requests().length, sent, "印の無い・壊れたフォルダーには送らない");
    // 接続のファイルに無い profile のフォルダー
    mkdirSync(path.join(root, "kintone", "stage", "3740-x"), { recursive: true });
    writeFileSync(path.join(root, "kintone", "stage", "3740-x", "a.json"), settings());
    const stage = sc(await s.call("pcraft_normalize", { workspaceId: root, path: "kintone/stage/3740-x/a.json", fields: "fields/3740.json" }));
    assert.deepEqual([stage.status, stage.error.code], ["denied", "PermissionError"]);
    // 印は保存・差し替えの書く先にできない
    const markFile = path.join(root, APP_DIR, ".pcraft-app.json");
    const markBefore = readFileSync(markFile, "utf8");
    const toMark = sc(await s.call("pcraft_save_settings", { workspaceId: root, path: `${APP_DIR}/.pcraft-app.json`, content: settings(), expectedAbsent: true }));
    assert.deepEqual([toMark.status, toMark.error?.code], ["denied", "PermissionError"], JSON.stringify(toMark));
    const toDot = sc(await s.call("pcraft_save_settings", { workspaceId: root, path: `${APP_DIR}/.hidden.json`, content: settings(), expectedAbsent: true }));
    assert.deepEqual([toDot.status, toDot.error.code], ["denied", "PermissionError"]);
    assert.equal(readFileSync(markFile, "utf8"), markBefore);
    assert.ok(!existsSync(path.join(root, APP_DIR, ".hidden.json")));
  } finally {
    await s.close();
    log.cleanup();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("iframe の接続先（trustedOrigin。15.8）: settings/ は profile、無ければ defaultProfile、決まらなければ null と理由。アプリのフォルダーはその profile（引数と違えば invalid）", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const s = await connectClaudeCode([root], connEnv(conn.file), { mockFetch: true });
  const norm = async (extra = {}) => sc(await s.call("pcraft_normalize", { workspaceId: root, path: "settings/見積書.json", fields: "fields/3740.json", ...extra }));
  try {
    assert.equal(sc(await s.call("pcraft_save_settings", { workspaceId: root, path: "settings/見積書.json", content: settings(), fields: "fields/3740.json", expectedAbsent: true })).result.trustedOrigin, "dev-x.cybozu.com");
    assert.equal((await norm()).result.trustedOrigin, "dev-x.cybozu.com");
    assert.equal((await norm({ profile: "prod" })).result.trustedOrigin, "x.cybozu.com");
    assert.deepEqual(errorOf(await s.call("pcraft_normalize", { workspaceId: root, path: "settings/見積書.json", fields: "fields/3740.json", profile: "stage" })), [true, false, "invalid", "unknown-profile"]);
    conn.write({ profiles: { prod: CONN.profiles.prod } });
    const none = await norm();
    assert.deepEqual([none.status, none.result.trustedOrigin], ["ok", null], "既定の profile が決まらなくても誤りにしない");
    assert.match(none.result.trustedOriginReason, /既定の profile が決まらない/);
    assert.equal((await norm({ profile: "prod" })).result.trustedOrigin, "x.cybozu.com");
    conn.write(CONN);
    assert.equal(sc(await s.call("pcraft_fields", { workspaceId: root, app: 3740 })).status, "ok");
    assert.equal(sc(await s.call("pcraft_save_settings", { workspaceId: root, path: `${APP_DIR}/見積書.json`, content: settings(), expectedAbsent: true })).status, "ok");
    const inFolder = sc(await s.call("pcraft_normalize", { workspaceId: root, path: `${APP_DIR}/見積書.json` }));
    assert.equal(inFolder.result.trustedOrigin, "dev-x.cybozu.com");
    const mismatch = sc(await s.call("pcraft_normalize", { workspaceId: root, path: `${APP_DIR}/見積書.json`, profile: "prod" }));
    assert.deepEqual([mismatch.status, mismatch.error.code], ["invalid", "InputError"]);
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop の kintone_get_app: 番号か、profile の接続先とゲストスペースが同じ URL。決めた項目だけ（作成者・説明は返さない）。別のオリジン・ゲストスペースの違い・ユーザー名の部分は断る", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const log = fetchLog();
  const s = await connectDesktop(root, connEnv(conn.file, { PCRAFT_TEST_FETCH_LOG: log.file }), { mockFetch: true });
  try {
    const { tools } = await s.client.listTools();
    assert.ok(tools.some((t) => t.name === "kintone_get_app") && tools.some((t) => t.name === "kintone_list_records"));
    const byId = sc(await s.call("kintone_get_app", { app: 3740 }));
    assert.equal(byId.status, "ok", JSON.stringify(byId));
    assert.deepEqual(Object.keys(byId.result).sort(), ["appId", "baseUrl", "code", "name", "profile", "spaceId", "threadId"]);
    assert.deepEqual([byId.result.appId, byId.result.name, byId.result.profile], [3740, "見積書(印刷屋)", "dev"]);
    assert.deepEqual(noValues(JSON.stringify(byId)), []);
    assert.equal(sc(await s.call("kintone_get_app", { app: "https://dev-x.cybozu.com/k/3740/?q=1#x" })).status, "ok");
    // ブラウザーから写した詳細画面・編集画面の URL もアプリの番号だけを使う（手での確認 3）
    for (const app of ["https://dev-x.cybozu.com/k/3740/show#record=3", "https://dev-x.cybozu.com/k/3740/show#record=3&mode=edit", "https://dev-x.cybozu.com/k/3740/edit"]) {
      const r = sc(await s.call("kintone_get_app", { app }));
      assert.deepEqual([r.status, r.result?.appId], ["ok", 3740], app);
    }
    assert.equal(sc(await s.call("kintone_get_app", { app: "https://x.cybozu.com/k/guest/7/3740/show#record=1", profile: "guest7" })).result?.guestSpaceId, 7);
    // ゲストスペース: profile の guestSpaceId と URL が同じときだけ（1 つの profile は 1 つのスペース。15.5）
    const guest = sc(await s.call("kintone_get_app", { app: "https://x.cybozu.com/k/guest/7/3740/", profile: "guest7" }));
    assert.deepEqual([guest.status, guest.result?.guestSpaceId, guest.result?.spaceId], ["ok", 7, "11"], JSON.stringify(guest));
    assert.deepEqual([log.requests().at(-1).path, log.requests().at(-1).token], ["/k/guest/7/v1/app.json", tokenHash(TOKENS.guest3740)]);
    assert.equal(sc(await s.call("kintone_get_app", { app: 3740, profile: "guest7" })).result.guestSpaceId, 7, "番号なら profile のゲストスペース");
    for (const [app, profile] of [["https://x.cybozu.com/k/3740/", "guest7"], ["https://x.cybozu.com/k/guest/8/3740/", "guest7"], ["https://dev-x.cybozu.com/k/guest/7/3740/", undefined]]) {
      assert.deepEqual(errorOf(await s.call("kintone_get_app", { app, ...(profile ? { profile } : {}) })), [true, false, "invalid", "guest-mismatch"], `${app} ${profile}`);
    }
    for (const app of ["https://x.cybozu.com/k/3740/", "https://u:p@dev-x.cybozu.com/k/3740/", "http://dev-x.cybozu.com/k/3740/", "https://dev-x.cybozu.com/k/3740/print", "https://dev-x.cybozu.com/k/admin/app/flow?app=3740", "見積書"]) {
      assert.deepEqual(errorOf(await s.call("kintone_get_app", { app })), [true, false, "invalid", "InputError"], app);
    }
    assert.deepEqual(leakedTokens(s.output()), []);
  } finally {
    await s.close();
    log.cleanup();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop の kintone_list_records: 5 件まで、形だけ（値は返さない）。limit / offset は断る。Claude Code には kintone_* を出さない", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const log = fetchLog();
  const s = await connectDesktop(root, connEnv(conn.file, { PCRAFT_TEST_FETCH_LOG: log.file }), { mockFetch: true });
  try {
    const r = sc(await s.call("kintone_list_records", { app: 3740, query: '見積番号 like "S-" order by $id desc' }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.equal(r.result.records.length, 5, "サーバーが 6 件返しても 5 件まで");
    assert.match(r.result.query, /limit 5$/);
    assert.deepEqual(noValues(JSON.stringify(r)), []);
    const bad = sc(await s.call("kintone_list_records", { app: 3740, query: "order by $id desc limit 100" }));
    assert.deepEqual([bad.status, bad.error.code], ["invalid", "QueryError"]);
    assert.ok(log.requests().every((q) => q.method === "GET" && q.token === tokenHash(TOKENS.dev3740)));
    assert.deepEqual(leakedTokens(s.output()), []);
  } finally {
    await s.close();
    log.cleanup();
  }
  const c = await connectClaudeCode([root], connEnv(conn.file), { mockFetch: true });
  try {
    const { tools } = await c.client.listTools();
    assert.ok(!tools.some((t) => t.name.startsWith("kintone_")), "Claude Code では公式の kintone MCP を使う（同じことをするツールを出さない）");
  } finally {
    await c.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
