// Codex の B1 レビュー（work-link/codex-review-print-craft-b1-2026-10-09.md）の指摘の試験:
//   BLOCKER 1 symlink で作業フォルダーの外を一覧しない / BLOCKER 2 preview がレコードの値を返さない / MAJOR 1 権限の個人の値を伏せる /
//   MAJOR 2 preview は描く前に必ず検査 / MAJOR 3 診断は zip を読み、絶対パスを返さない / MAJOR 4 相対パスだけ / MINOR 1・2
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@rex0220/print-craft-authoring-tools/core";
import { FIELDS_TEXT, SETTINGS_TEXT, SKIP as skip, ZIP, connEnv, connectClaudeCode, makeConn, makeWorkspace, saveInput, sc, settings } from "./helpers.mjs";

const RECORD_TEXT = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "record-3740-3.json"), "utf8");
const SECRET = "外の秘密";

/** 作業フォルダーの外のフォルダー（名前に SECRET を含むファイルとフォルダー） */
function outside() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-outside-")));
  mkdirSync(path.join(dir, `101-${SECRET}アプリ`, "records"), { recursive: true });
  writeFileSync(path.join(dir, `101-${SECRET}アプリ`, "fields.json"), FIELDS_TEXT);
  writeFileSync(path.join(dir, `101-${SECRET}アプリ`, "records", `${SECRET}レコード.json`), "{}");
  writeFileSync(path.join(dir, `${SECRET}.json`), "{}");
  return dir;
}

test("BLOCKER 1: kintone/<profile>・アプリのフォルダー・records・inbox が外への symlink なら、一覧を作らず・kintone に送らずに断る（外の名前を返さない）", { skip }, async () => {
  const out = outside();
  const conn = makeConn();
  const dev = core.pickProfile(core.loadConnections(conn.file, { workspaceRoots: [], env: {} }), "dev");
  const cases = [
    ["profile のフォルダー", (root) => {
      mkdirSync(path.join(root, "kintone"));
      symlinkSync(out, path.join(root, "kintone", "dev"));
    }],
    ["アプリのフォルダー", (root) => {
      mkdirSync(path.join(root, "kintone", "dev"), { recursive: true });
      symlinkSync(path.join(out, `101-${SECRET}アプリ`), path.join(root, "kintone", "dev", "101-見積書"));
    }],
    ["records", (root) => {
      const app = path.join(root, "kintone", "dev", "101-見積書");
      core.ensureAppFolder(app, dev, 101);
      writeFileSync(path.join(app, "fields.json"), FIELDS_TEXT);
      symlinkSync(path.join(out, `101-${SECRET}アプリ`, "records"), path.join(app, "records"));
    }]
  ];
  try {
    for (const [name, make] of cases) {
      const root = makeWorkspace();
      make(root);
      const s = await connectClaudeCode([root], connEnv(conn.file), { mockFetch: true });
      try {
        const files = sc(await s.call("pcraft_files", { workspaceId: root, app: 101 }));
        // アプリのフォルダーそのものが symlink のときは、中核がフォルダーとして数えない（無い = invalid）。どちらでも外は一覧しない
        assert.ok(files.status === "denied" || (name === "アプリのフォルダー" && files.status === "invalid"), `${name}: ${JSON.stringify(files)}`);
        for (const [tool, input] of [["pcraft_record", { workspaceId: root, app: 101, id: 3 }], ["pcraft_edit", { workspaceId: root, app: 101 }]]) {
          const r = sc(await s.call(tool, input));
          assert.notEqual(r.status, "ok", `${name} ${tool}: ${JSON.stringify(r)}`);
        }
        if (name === "profile のフォルダー") assert.deepEqual(sc(await s.call("pcraft_files", { workspaceId: root })).error?.code, "PathError", "profile ごとの一覧も作らない");
        // profile のフォルダーが外なら、kintone に送る前に断る（records だけが外なら fields.json と pull のファイルはアプリのフォルダーに書ける）
        if (name === "profile のフォルダー") {
          for (const tool of ["pcraft_fields", "pcraft_pull"]) assert.equal(sc(await s.call(tool, { workspaceId: root, app: 101 })).status, "denied", `${name} ${tool}`);
        }
        assert.ok(!s.output().includes(SECRET), `${name}: 外の名前を返さない`);
      } finally {
        await s.close();
        rmSync(root, { recursive: true, force: true });
      }
    }
    const root = makeWorkspace();
    symlinkSync(out, path.join(root, "inbox"));
    const s = await connectClaudeCode([root], connEnv(conn.file));
    try {
      const t = sc(await s.call("pcraft_take", { workspaceId: root }));
      assert.deepEqual([t.status, t.error.code], ["denied", "PathError"]);
      assert.ok(!s.output().includes(SECRET), "inbox: 外の名前を返さない");
      assert.ok(existsSync(path.join(out, `${SECRET}.json`)), "外のファイルを動かさない");
    } finally {
      await s.close();
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    conn.cleanup();
    rmSync(out, { recursive: true, force: true });
  }
});

test("MAJOR 4: パスの引数は作業フォルダーからの相対パスだけ（絶対パス・ドライブ名・~・\\・..）。どのツールでも denied（PathError）", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    const bad = [path.join(root, "settings", "a.json"), "/etc/hosts", "../x.json", "settings/../settings/a.json", "C:\\x.json", "C:x.json", "settings\\a.json", "~/x.json"];
    const calls = (p) => [
      ["pcraft_save_settings", saveInput(root, p)],
      ["pcraft_save_settings", saveInput(root, "settings/ok.json", undefined, { fields: p })],
      ["pcraft_buttons", { workspaceId: root, path: p }],
      ["pcraft_normalize", { workspaceId: root, path: p, fields: "fields/3740.json" }],
      ["pcraft_preview", { workspaceId: root, path: "settings/a.json", record: p, fields: "fields/3740.json" }],
      ["pcraft_update_button", { workspaceId: root, path: p, button: "見積書", expectedDigest: "0".repeat(64), replacement: "{}" }],
      ["pcraft_record", { workspaceId: root, app: 3740, id: 3, fieldsFrom: p }],
      ["pcraft_edit", { workspaceId: root, path: p }],
      ["pcraft_diff", { workspaceId: root, before: p, after: "settings/a.json" }]
    ];
    for (const p of bad) {
      for (const [tool, input] of calls(p)) {
        const r = sc(await s.call(tool, input));
        assert.deepEqual([r?.status, r?.error?.code], ["denied", "PathError"], `${tool} ${p}`);
      }
    }
    assert.ok(!existsSync(path.join(root, "settings", "ok.json")), "保存しない");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MAJOR 1: pcraft_buttons と pcraft_diff は権限のユーザー・組織・グループ・ゲストの値とゲストの一覧を伏せる（件数と digest。変わったことは分かる）", { skip }, async () => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, "settings"));
  const base = JSON.parse(SETTINGS_TEXT);
  const withAuth = (users) => ({
    ...base,
    guestsInfo: [{ state: true, email: "guest-b@example.com", name: "山田花子", note: "" }],
    pluginInfos: [{ ...base.pluginInfos[0], authority: true, users, organizations: "営業部", groups: "管理グループ", guest: "guest-a@example.com" }]
  });
  writeFileSync(path.join(root, "settings", "前.json"), JSON.stringify(withAuth("taro")));
  writeFileSync(path.join(root, "settings", "後.json"), JSON.stringify(withAuth("taro,hanako")));
  const s = await connectClaudeCode([root]);
  try {
    const b = sc(await s.call("pcraft_buttons", { workspaceId: root, path: "settings/後.json", button: "見積書" }));
    assert.equal(b.status, "ok");
    assert.match(b.result.text, /ユーザー 2 件/);
    const d = sc(await s.call("pcraft_diff", { workspaceId: root, before: "settings/前.json", after: "settings/後.json" }));
    assert.equal(d.status, "ok");
    assert.match(d.result.text, /users/, "変わったことは分かる");
    for (const v of ["taro", "hanako", "営業部", "管理グループ", "guest-a@example.com", "guest-b@example.com", "山田花子"]) assert.ok(!s.output().includes(v), `値を返さない: ${v}`);
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MAJOR 2: preview は描く前に必ず検査する（例外にならない検査のエラーでも描かない）", { skip }, async () => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, "settings"));
  mkdirSync(path.join(root, "records"));
  writeFileSync(path.join(root, "records", "3740-3.json"), RECORD_TEXT);
  // 同じ名前の有効なボタンが 2 つ（menu.duplicate）: 検査のエラーだが、描いても例外にはならない
  const base = JSON.parse(SETTINGS_TEXT);
  writeFileSync(path.join(root, "settings", "a.json"), JSON.stringify({ ...base, pluginInfos: [base.pluginInfos[0], base.pluginInfos[0]] }));
  const s = await connectClaudeCode([root]);
  try {
    const r = sc(await s.call("pcraft_preview", { workspaceId: root, path: "settings/a.json", record: "records/3740-3.json", fields: "fields/3740.json" }));
    assert.deepEqual([r.status, r.error.code], ["invalid", "NormalizeError"]);
    assert.ok(r.findings.some((f) => f.level === "error" && f.rule === "menu.duplicate"), JSON.stringify(r.findings));
    assert.ok(!existsSync(path.join(root, "out")), "描かない・書かない");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MAJOR 3: 診断は zip を実際に読む（無い・zip でないなら ready: false、readable: false）。絶対パスを返さない", { skip }, async () => {
  const root = makeWorkspace();
  const notZip = path.join(root, "not-a-zip.zip");
  writeFileSync(notZip, "x");
  try {
    for (const zip of [path.join(root, "無い.zip"), notZip]) {
      const s = await connectClaudeCode([root], { PCRAFT_PLUGIN_ZIP: zip });
      try {
        for (const [tool, input] of [["pcraft_status", {}], ["pcraft_workspace_status", { workspaceId: root }]]) {
          const r = sc(await s.call(tool, input));
          assert.equal(r.status, "ok", tool);
          assert.equal(r.result.ready, false, tool);
          assert.deepEqual([r.result.pluginZip.readable, r.result.pluginZip.compatible, r.result.pluginZip.fileName], [false, false, path.basename(zip)], tool);
          assert.ok(!JSON.stringify(r).includes(root), `${tool}: 絶対パスを返さない`);
        }
      } finally {
        await s.close();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("BLOCKER 2 / MINOR 2: 式の誤りは場所だけ（文は返さない）、findings は 100 件まで（中身の関数）", async () => {
  const { safeRenderError } = await import("../src/tools/preview.ts");
  assert.equal(safeRenderError("HTML 設定 3 行目 ${DATE_FORMAT(宛名)}: 日付として読めない: □□□□株式会社"), "HTML 設定 3 行目の ${…} の評価に失敗（誤りの文は値を含みうるので返さない）");
  assert.equal(safeRenderError("HTML 設定 4 行目の計算式: S-0000003 は数値でない"), "HTML 設定 4 行目の計算式の評価に失敗（誤りの文は値を含みうるので返さない）");
  assert.equal(safeRenderError("何か別の文 □□□□株式会社"), "式の評価に失敗（誤りの文は値を含みうるので返さない）");
  assert.match(safeRenderError('ページ要素（class="rex0220-pcraft-page"）が無い。印刷屋は 0 ページの PDF を作る'), /ページ要素/);
  // 中核の preview の掃除の確かめが通らず帳票を出さなかった（tools 2.0.1）: 式の誤りと言い換えず、決まった文
  assert.equal(safeRenderError("帳票を表示しない: 掃除した帳票の HTML をブラウザーが読むと、掃除の結果と違う形になる（タグでない「<」がある（注釈・CDATA・処理命令など））。…"), "帳票を表示しない（掃除した帳票の HTML をブラウザーが読むと形が変わる。レコードの値や HTML 設定に、注釈・CDATA・SVG などの書き方が無いか確かめる）");
  const { capFindings, MAX_FINDINGS } = await import("../src/result.ts");
  const many = Array.from({ length: 150 }, (_, i) => ({ level: "warning", rule: "x", message: String(i) }));
  const capped = capFindings(many);
  assert.equal(capped.length, MAX_FINDINGS);
  assert.equal(capped.at(-1).rule, "truncated");
  assert.equal(capFindings(many.slice(0, 100)).length, 100);
});
