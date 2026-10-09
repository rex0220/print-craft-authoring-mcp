// Codex の B1 再レビュー（work-link/codex-review-print-craft-b1-r2-2026-10-09.md）の指摘の試験:
//   BLOCKER 1 preview でレコードの値を標準エラー・応答に出さない（$fname の評価の失敗、moment の警告、描画の想定外の例外、読めない JSON）
//   BLOCKER 2 設定のファイルを作業フォルダーの中・外への symlink から読まない（tools 2.0.0 からは kintone の接続のファイル。実装案 15.3）/
//   MAJOR 1 zip の誤りの種類 / MAJOR 2 作業フォルダーごとの別の zip /
//   MINOR 1 パスの形 / pcraft_files の絶対パス / 足りなかった試験（kintone/・out/・settings/ などの symlink、pull の伏せ字）
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { FIELDS_TEXT, SETTINGS_TEXT, SKIP as skip, ZIP, connEnv, connectClaudeCode, makeConn, makeWorkspace, saveInput, sc } from "./helpers.mjs";
import { makePluginZip, stubInnerEntries } from "./zip-stub.mjs";

const RECORD_TEXT = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "record-3740-3.json"), "utf8");
/** レコードの値（宛名）。応答にも標準エラーにも出てはいけない */
const VALUE = "□□□□株式会社";
const SECRET = "外の秘密";
const tmpRoot = () => realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-r2-")));

/** 設定の見積書（fixture）を保存し、records/3740-3.json を置いた作業フォルダー */
async function prepared(s, root, file = "settings/見積書.json", content = SETTINGS_TEXT) {
  const r = sc(await s.call("pcraft_save_settings", saveInput(root, file, content)));
  assert.equal(r.status, "ok", JSON.stringify(r));
  mkdirSync(path.join(root, "records"), { recursive: true });
  writeFileSync(path.join(root, "records", "3740-3.json"), RECORD_TEXT);
}

test("BLOCKER 1: $fname の評価の失敗（印刷屋の console.log）と moment の警告（値を含む）を標準エラーに出さない。応答にも値を出さない", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    const base = JSON.parse(SETTINGS_TEXT);
    const row = structuredClone(base.pluginInfos[0]);
    // 検査（normalize）は通り、レコードで評価すると失敗する式。DATE_FORMAT は moment の警告に値を入れ、JSON_P は例外になる
    row.tagsInfo.fieldsInfo[1].formulaSet = 'DATE_FORMAT(宛名, "YYYY") & JSON_P(宛名)';
    await prepared(s, root, "settings/fname.json", JSON.stringify({ ...base, pluginInfos: [row] }));
    const r = sc(await s.call("pcraft_preview", { workspaceId: root, path: "settings/fname.json", record: "records/3740-3.json", fields: "fields/3740.json" }));
    assert.equal(r.status, "ok", JSON.stringify(r));
  } finally {
    await s.close();
  }
  try {
    assert.ok(!s.output().includes(VALUE), "レコードの値を応答にも標準エラーにも出さない");
    assert.ok(!/file name err|Deprecation warning|_isAMomentObject/.test(s.stderr()), "印刷屋と moment のログを出さない");
    assert.match(s.stderr(), /console の出力を \d+ 件捨てた/, "捨てた件数だけを残す");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("BLOCKER 1: 描画の想定外の例外（明細の行の形が違うと例外の文に値が入る）は RenderError の決まった文。読めない JSON の文に中身を入れない", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    await prepared(s, root);
    const bad = JSON.parse(RECORD_TEXT);
    bad.record.見積明細.value = [{ id: "1", value: VALUE }];
    writeFileSync(path.join(root, "records", "bad-row.json"), JSON.stringify(bad));
    const r = sc(await s.call("pcraft_preview", { workspaceId: root, path: "settings/見積書.json", record: "records/bad-row.json", fields: "fields/3740.json" }));
    assert.deepEqual([r.status, r.error.code], ["failed", "RenderError"], JSON.stringify(r));
    assert.match(r.error.message, /誤りの文はレコードの値を含みうるので返さない/);
    writeFileSync(path.join(root, "records", "broken.json"), `{"record": {"宛名": {"type": "SINGLE_LINE_TEXT", "value": ${VALUE}}}}`);
    const broken = sc(await s.call("pcraft_preview", { workspaceId: root, path: "settings/見積書.json", record: "records/broken.json", fields: "fields/3740.json" }));
    assert.deepEqual([broken.status, broken.error.code], ["invalid", "InputError"]);
    assert.equal(broken.error.message, "レコードのファイルを JSON として読めない: records/broken.json（中身は返さない）");
    const shape = sc(await s.call("pcraft_preview", { workspaceId: root, path: "settings/見積書.json", record: "fields/3740.json", fields: "fields/3740.json" }));
    assert.deepEqual([shape.status, shape.error.code], ["invalid", "InputError"], "レコードの形の誤りは中核の決まった文");
    assert.match(shape.error.message, /レコードの JSON の形が分からない/);
    // 設定として読んでも、JSON.parse の誤りの文の中身（値）と作業フォルダーの絶対パスを返さない
    const b = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "records/broken.json" }));
    assert.equal(b.status, "invalid");
    assert.ok(!JSON.stringify(b).includes(root), JSON.stringify(b));
  } finally {
    await s.close();
  }
  try {
    assert.ok(!s.output().includes(VALUE), "レコードの値を応答にも標準エラーにも出さない");
    assert.match(s.stderr(), /pcraft_preview: 帳票を描けなかった（TypeError。文はレコードの値を含みうるので出さない）/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("BLOCKER 2（15.3）: kintone の接続のファイルは作業フォルダーの外だけ（中のファイル、中の symlink、中を指す外の symlink、別の登録済みの作業フォルダーの中は inside-workspace）。environments.json は外への symlink でも中身を読まない", { skip }, async (t) => {
  const root = makeWorkspace();
  const other = makeWorkspace("pcraft-mcp-other-");
  const out = tmpRoot();
  const conn = JSON.stringify({ defaultProfile: "dev", profiles: { dev: { baseUrl: "https://dev-x.cybozu.com", tokenMap: { APP101: SECRET } } } });
  const outsideConn = path.join(out, "ksql.config.json");
  writeFileSync(outsideConn, conn);
  writeFileSync(path.join(root, "in.json"), conn);
  writeFileSync(path.join(other, "other.json"), conn);
  writeFileSync(path.join(out, "environments.json"), JSON.stringify({ default: SECRET, environments: { [SECRET]: { baseUrl: "https://secret.cybozu.com", role: "development" } } }));
  try {
    symlinkSync(outsideConn, path.join(root, "link.json"));
    symlinkSync(path.join(root, "in.json"), path.join(out, "to-inside.json"));
  } catch (e) {
    t.skip(`symlink を作れない: ${e.message}`);
    return;
  }
  try {
    for (const file of [path.join(root, "in.json"), path.join(root, "link.json"), path.join(out, "to-inside.json"), path.join(other, "other.json")]) {
      const s = await connectClaudeCode([root, other], { PCRAFT_PLUGIN_ZIP: ZIP, PCRAFT_KINTONE_CONFIG: file });
      try {
        const st = sc(await s.call("pcraft_workspace_status", { workspaceId: root }));
        assert.deepEqual([st.status, st.result.connection.problem?.code], ["ok", "inside-workspace"], `${file}: ${JSON.stringify(st.result.connection)}`);
        const f = sc(await s.call("pcraft_fields", { workspaceId: root, app: 101 }));
        assert.deepEqual([f.status, f.error?.code], ["denied", "inside-workspace"], file);
        assert.ok(!s.output().includes(SECRET), `${file}: 中身を返さない`);
      } finally {
        await s.close();
      }
    }
    // environments.json が外への symlink: lstat で有無だけを見る（中身を読まない）
    symlinkSync(path.join(out, "environments.json"), path.join(root, "environments.json"));
    const s = await connectClaudeCode([root], { PCRAFT_PLUGIN_ZIP: ZIP });
    try {
      const st = sc(await s.call("pcraft_workspace_status", { workspaceId: root }));
      assert.deepEqual([st.result.mode, st.result.environmentsJson.exists], ["legacy-blocked", true]);
      assert.equal(sc(await s.call("pcraft_save_settings", saveInput(root, "settings/a.json"))).status, "ok", "settings/ の作業は動く");
      assert.ok(!/外の秘密|secret\.cybozu/.test(s.output()), "外のファイルの中身を返さない");
    } finally {
      await s.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("MAJOR 1: zip の誤りを種類（code）ごとの決まった文で返す。読めない（無い・壊れている）と、読めるが合わない（版・鍵・API の版）を分ける。パスを返さない", { skip }, async () => {
  const zips = tmpRoot();
  const cases = [
    ["missing", path.join(zips, "無い.zip"), { readable: false, compatible: false }],
    ["unreadable", "garbage", { readable: false, compatible: false }],
    ["unsupported-version", makePluginZip(stubInnerEntries({ "manifest.json": JSON.stringify({ version: 5 }) })), { readable: true, compatible: false, pluginVersion: "5" }],
    ["not-print-craft", makePluginZip(stubInnerEntries(), { PUBKEY: Buffer.from("not the print-craft key") }), { readable: true, compatible: false, pluginVersion: "6" }],
    // 最後: スタブのコードを動かす（版の照合まで進む）。失敗するとそのサーバーでは以後 restart-required になるので、ほかの読み込みより後に
    ["api-unsupported", makePluginZip(stubInnerEntries({ "config_js/print-craft-authoring-api.js": 'window.rex0220PrintCraftAuthoring = { apiVersion: 3, pluginVersion: "6" };' })), { readable: true, compatible: false, pluginVersion: "6", authoringApiVersion: 3 }]
  ];
  const roots = cases.map(([code, data]) => {
    const root = makeWorkspace();
    let zip = data;
    if (typeof data !== "string" || data === "garbage") {
      zip = path.join(zips, `${code}.zip`);
      writeFileSync(zip, data);
    }
    writeFileSync(path.join(root, ".env"), `PCRAFT_PLUGIN_ZIP=${zip}\n`);
    return root;
  });
  const s = await connectClaudeCode(roots, {});
  try {
    const check = async (i) => {
      const [code, , expected] = cases[i];
      const st = sc(await s.call("pcraft_workspace_status", { workspaceId: roots[i] }));
      assert.equal(st.status, "ok", code);
      const z = st.result.pluginZip;
      assert.equal(z.code, code, JSON.stringify(z));
      for (const [k, v] of Object.entries(expected)) assert.equal(z[k], v, `${code} の ${k}`);
      assert.equal(z.fileName, path.basename(i === 0 ? cases[0][1] : `${code}.zip`));
      assert.ok(!JSON.stringify(st).includes(zips) && !JSON.stringify(st).includes(roots[i]), `${code}: 絶対パスを返さない`);
      assert.equal(st.result.ready, false);
    };
    for (let i = 0; i < cases.length - 1; i++) await check(i);
    const incompatible = sc(await s.call("pcraft_normalize", { workspaceId: roots[2], path: "fields/3740.json", fields: "fields/3740.json" }));
    assert.deepEqual([incompatible.status, incompatible.error.code], ["incompatible", "IncompatibleError"], "版が対応外は incompatible");
    assert.match(incompatible.error.message, /印刷屋の版 5 の zip には対応していない/);
    const unreadable = sc(await s.call("pcraft_normalize", { workspaceId: roots[1], path: "fields/3740.json", fields: "fields/3740.json" }));
    assert.deepEqual([unreadable.status, unreadable.error.code], ["failed", "PluginZipError"]);
    assert.ok(!JSON.stringify(unreadable).includes(zips), "zip のパスを返さない");
    // 最後: zip のコードを動かす失敗（api-unsupported）。以後このサーバーは restart-required（review-b1-r3.test.mjs）
    await check(cases.length - 1);
  } finally {
    await s.close();
    for (const r of roots) rmSync(r, { recursive: true, force: true });
    rmSync(zips, { recursive: true, force: true });
  }
});

test("MAJOR 2: 2 つの作業フォルダーが別の zip を使うと、後のほうは zip-changed（最初のエンジンで黙って動かない）", { skip }, async () => {
  const zips = tmpRoot();
  const [a, b] = [makeWorkspace(), makeWorkspace()];
  for (const [root, name] of [[a, "a.zip"], [b, "b.zip"]]) {
    copyFileSync(ZIP, path.join(zips, name));
    writeFileSync(path.join(root, ".env"), `PCRAFT_PLUGIN_ZIP=${path.join(zips, name)}\n`);
  }
  const conn = makeConn();
  const s = await connectClaudeCode([a, b], { PCRAFT_KINTONE_CONFIG: conn.file });
  try {
    const sa = sc(await s.call("pcraft_workspace_status", { workspaceId: a }));
    assert.deepEqual([sa.result.pluginZip.readable, sa.result.pluginZip.compatible, sa.result.ready], [true, true, true], JSON.stringify(sa.result));
    const sb = sc(await s.call("pcraft_workspace_status", { workspaceId: b }));
    assert.equal(sb.result.pluginZip.code, "zip-changed", JSON.stringify(sb.result.pluginZip));
    assert.equal(sb.result.ready, false);
    assert.match(sb.result.pluginZip.problem, /このサーバーが読み込んだものと違う.*\/mcp で print-craft を再接続/);
    const nb = sc(await s.call("pcraft_save_settings", saveInput(b, "settings/x.json")));
    assert.deepEqual([nb.status, nb.error.code], ["failed", "PluginZipError"], JSON.stringify(nb));
    assert.ok(!existsSync(path.join(b, "settings", "x.json")), "別の zip のエンジンで保存しない");
    const na = sc(await s.call("pcraft_save_settings", saveInput(a, "settings/x.json")));
    assert.equal(na.status, "ok", "読み込んだ zip の作業フォルダーは今までどおり");
  } finally {
    await s.close();
    conn.cleanup();
    for (const r of [a, b]) rmSync(r, { recursive: true, force: true });
    rmSync(zips, { recursive: true, force: true });
  }
});

test("MINOR 1: パスの引数の形。外へ出る形は denied（PathError）、ファイルのパスの形でないもの（.、./、末尾の /、//）は invalid（InputError）。日本語と a..b は通す", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root], { PCRAFT_PLUGIN_ZIP: ZIP }, { mockFetch: true });
  const DENIED = ["/etc/x.json", "C:\\x.json", "C:x.json", "\\\\server\\share\\x.json", "\\\\?\\C:\\x.json", "~/x.json", "settings\\x.json", "settings/../x.json", "x\u0000.json"];
  const INVALID = [".", "settings/", "./settings/見積書.json", "settings//見積書.json", "settings/./見積書.json"];
  const digest = "0".repeat(64);
  const calls = [
    ["pcraft_buttons", (p) => ({ path: p })],
    ["pcraft_normalize", (p) => ({ path: p, fields: "fields/3740.json" })],
    ["pcraft_normalize", (p) => ({ path: "settings/見積書.json", fields: p })],
    ["pcraft_preview", (p) => ({ path: p, record: "records/3740-3.json", fields: "fields/3740.json" })],
    ["pcraft_preview", (p) => ({ path: "settings/見積書.json", record: p, fields: "fields/3740.json" })],
    ["pcraft_save_settings", (p) => saveInput(root, p)],
    ["pcraft_save_settings", (p) => saveInput(root, "settings/y.json", SETTINGS_TEXT, { fields: p })],
    ["pcraft_update_button", (p) => ({ path: p, button: "見積書", expectedDigest: digest, replacement: "{}", fields: "fields/3740.json" })],
    ["pcraft_diff", (p) => ({ before: p, after: "settings/見積書.json" })],
    ["pcraft_diff", (p) => ({ before: "settings/見積書.json", after: p })],
    ["pcraft_record", (p) => ({ app: 3740, id: 3, fieldsFrom: p })]
  ];
  try {
    await prepared(s, root);
    for (const [tool, input] of calls) {
      for (const p of DENIED) {
        const r = sc(await s.call(tool, { workspaceId: root, ...input(p) }));
        assert.deepEqual([r.status, r.error?.code], ["denied", "PathError"], `${tool} ${JSON.stringify(p)}: ${JSON.stringify(r)}`);
      }
      for (const p of INVALID) {
        const r = sc(await s.call(tool, { workspaceId: root, ...input(p) }));
        assert.deepEqual([r.status, r.error?.code], ["invalid", "InputError"], `${tool} ${JSON.stringify(p)}: ${JSON.stringify(r)}`);
      }
    }
    writeFileSync(path.join(root, "settings", "a..b.json"), SETTINGS_TEXT);
    const dots = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/a..b.json" }));
    assert.equal(dots.status, "ok", "a..b は .. の段ではない");
    const ja = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/見積書.json" }));
    assert.equal(ja.status, "ok");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pcraft_files は作業フォルダーの絶対パスを返さない（名前だけ）。kintone/ そのもの・profile のフォルダー・out/・settings/・records/・inbox/ が外への symlink なら denied", { skip }, async (t) => {
  const out = tmpRoot();
  mkdirSync(path.join(out, "dev", `101-${SECRET}`), { recursive: true });
  writeFileSync(path.join(out, `${SECRET}.json`), "{}");
  const conn = makeConn();
  const dev = core.pickProfile(core.loadConnections(conn.file, { workspaceRoots: [], env: {} }), "dev");
  const plain = makeWorkspace();
  const s0 = await connectClaudeCode([plain], connEnv(conn.file));
  try {
    const r = sc(await s0.call("pcraft_files", { workspaceId: plain }));
    assert.equal(r.status, "ok");
    assert.deepEqual(r.result.workspace, { name: path.basename(plain) });
    assert.ok(!JSON.stringify(r).includes(plain), "絶対パスを返さない");
  } finally {
    await s0.close();
    rmSync(plain, { recursive: true, force: true });
  }
  const cases = [
    ["kintone/", {}, (root) => symlinkSync(out, path.join(root, "kintone"))],
    ["kintone/dev", {}, (root) => {
      mkdirSync(path.join(root, "kintone"));
      symlinkSync(path.join(out, "dev"), path.join(root, "kintone", "dev"));
    }],
    ["out/", { app: 101 }, (root) => {
      const app = path.join(root, "kintone", "dev", "101-見積書");
      core.ensureAppFolder(app, dev, 101);
      symlinkSync(out, path.join(app, "out"));
    }],
    ["settings/", {}, (root) => symlinkSync(out, path.join(root, "settings"))],
    ["records/", {}, (root) => symlinkSync(out, path.join(root, "records"))],
    ["inbox/", {}, (root) => symlinkSync(out, path.join(root, "inbox"))]
  ];
  try {
    for (const [name, input, make] of cases) {
      const root = makeWorkspace();
      try {
        make(root);
      } catch (e) {
        t.skip(`symlink を作れない: ${e.message}`);
        rmSync(root, { recursive: true, force: true });
        return;
      }
      const s = await connectClaudeCode([root], connEnv(conn.file));
      try {
        const r = sc(await s.call("pcraft_files", { workspaceId: root, ...input }));
        assert.deepEqual([r.status, r.error?.code], ["denied", "PathError"], `${name}: ${JSON.stringify(r)}`);
        assert.ok(!s.output().includes(SECRET), `${name}: 外の名前を返さない`);
      } finally {
        await s.close();
        rmSync(root, { recursive: true, force: true });
      }
    }
  } finally {
    conn.cleanup();
    rmSync(out, { recursive: true, force: true });
  }
});

test("pcraft_pull のボタンの一覧も、権限のユーザー・組織・グループ・ゲストの値を伏せる", { skip }, async () => {
  const tmp = tmpRoot();
  const config = path.join(tmp, "plugin-config.json");
  const engine = await core.loadEngine({ pluginZip: ZIP });
  const base = JSON.parse(SETTINGS_TEXT);
  const text = JSON.stringify({ ...base, pluginInfos: [{ ...base.pluginInfos[0], authority: true, users: "user-a,user-b", organizations: "営業部", groups: "管理グループ", guest: "guest-a@example.com" }] });
  const n = await core.normalizeSettings({ settingsText: text, settingsFile: "settings/a.json", fields: JSON.parse(FIELDS_TEXT), engine });
  const { date, pluginName, pluginID, PluginVersion, appId, appName, ...body } = n.output;
  writeFileSync(config, JSON.stringify(await engine.api.writeConfig({ ...body, pluginLastUpdate: "2026-10-05 10:00:00", pluginUpdater: "佐藤", pluginProductEnv: true }, "compressed")));
  const root = makeWorkspace();
  const conn = makeConn();
  const s = await connectClaudeCode([root], connEnv(conn.file, { PCRAFT_TEST_PLUGIN_CONFIG: config }), { mockFetch: true });
  try {
    const r = sc(await s.call("pcraft_pull", { workspaceId: root, app: 3740 }));
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.match(r.result.path, /^kintone\/dev\/3740-/);
    assert.match(r.result.buttons, /権限で絞る/);
    assert.match(readFileSync(path.join(root, r.result.path), "utf8"), /user-a,user-b/, "取った設定には権限の値がある");
    assert.ok(!/user-a|guest-a@example\.com|営業部|管理グループ/.test(JSON.stringify(r)), "応答には権限の値を返さない");
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
});
