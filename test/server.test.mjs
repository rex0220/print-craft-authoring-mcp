// print-craft MCP の試験（試作 0-3b の試験を元にした）: ツールの一覧と入力の厳しいスキーマ、指示、pcraft_status、
// pcraft_save_settings の ok / conflict / invalid / denied / failed（5.2）、作業フォルダーの結び付け（4.1）、秘密の値を出さないこと
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIELDS_TEXT, SECRET, SKIP as skip, VERSION, ZIP, connEnv, connect, connectClaudeCode, connectDesktop, leakedTokens, makeConn, makeWorkspace, saveInput, sc, settings } from "./helpers.mjs";

const TOOLS = ["pcraft_docs", "pcraft_status", "pcraft_workspace_status", "pcraft_save_settings", "pcraft_update_button", "pcraft_buttons", "pcraft_normalize", "pcraft_preview", "pcraft_try", "pcraft_fields", "pcraft_record", "pcraft_pull", "pcraft_files", "pcraft_take", "pcraft_edit", "pcraft_diff"];

test("ツールの一覧と入力の厳しいスキーマ（additionalProperties: false。Claude Code では workspaceId が必須）。指示の 1 行目に版。pcraft_status の capabilities", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const s = await connectClaudeCode([root], connEnv(conn.file));
  try {
    const { tools } = await s.client.listTools();
    assert.deepEqual(tools.map((t) => t.name), TOOLS);
    for (const t of tools) assert.equal(t.inputSchema.additionalProperties, false, t.name);
    const save = tools.find((t) => t.name === "pcraft_save_settings");
    assert.deepEqual([...save.inputSchema.required].sort(), ["content", "expectedAbsent", "path", "workspaceId"]);
    assert.match(save.description, /推し量らず、必ずこのツールを呼び/, "結果を推し量らせない（試作 0-3b）");
    assert.doesNotMatch(save.description, /本番|ダウンロードのファイル|書ける場所/, "断る場合の一覧は説明に書かない（推し量りの材料になる）");
    assert.equal(tools.find((t) => t.name === "pcraft_status").annotations.readOnlyHint, true);
    assert.equal(tools.find((t) => t.name === "pcraft_workspace_status").annotations.readOnlyHint, true);
    const instructions = s.client.getInstructions?.() ?? s.client.getDiscoverResult?.()?.instructions;
    assert.match(String(instructions).split("\n")[0], new RegExp(`^print-craft MCP ${VERSION.replace(/\./g, "\\.")}（中核 @rex0220/print-craft-authoring-tools`));
    const st = sc(await s.call("pcraft_status", {}));
    assert.equal(st.result.ready, true, JSON.stringify(st.result.next));
    assert.equal(st.result.workspace.registered, 1);
    assert.deepEqual(st.result.workspace.names, [path.basename(root)]);
    assert.equal(st.result.pluginZip.source, "設定項目");
    assert.deepEqual([st.result.pluginZip.readable, st.result.pluginZip.compatible, st.result.pluginZip.pluginVersion, st.result.pluginZip.authoringApiVersion], [true, true, "7", 2], "zip を実際に読む");
    assert.ok(!JSON.stringify(st).includes(root) && !JSON.stringify(st).includes(ZIP) && !JSON.stringify(st).includes(conn.file), "絶対パスを返さない（Codex の B1 レビュー MAJOR 3）");
    assert.equal(st.result.version, VERSION);
    assert.deepEqual(st.result.capabilities, { authoring: { ready: true }, kintone: { ready: true, fileName: "ksql.config.json", profiles: 3 } });
  } finally {
    await s.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
  // 接続のファイルが無ければ kintone は使えない（診断は ok、ready: false と理由の code。kintone を使わないツールは動く）
  const s2 = await connectClaudeCode([root]);
  try {
    const st = sc(await s2.call("pcraft_status", {}));
    assert.deepEqual([st.status, st.result.ready, st.result.capabilities.authoring.ready, st.result.capabilities.kintone], ["ok", false, true, { ready: false, code: "not-configured" }]);
    assert.match(st.result.next.join("\n"), /kintone を使うツール（pcraft_fields など）には、\/config で print-craft の「kintone の接続のファイル」/);
  } finally {
    await s2.close();
  }
});

test("保存は ok（digest は確定したファイル。settings/ が無くても作る）、同じ名前は conflict、normalize のエラーは invalid（保存しない）", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    const okR = await s.call("pcraft_save_settings", saveInput(root, "settings/APP3740-見積書-見積書.json"));
    assert.equal(okR.isError, false, JSON.stringify(sc(okR)));
    assert.equal(sc(okR).status, "ok");
    const file = path.join(root, "settings", "APP3740-見積書-見積書.json");
    assert.equal(sc(okR).digest, createHash("sha256").update(readFileSync(file)).digest("hex"));
    assert.ok(JSON.parse(readFileSync(file, "utf8")).usedFields, "normalize の派生値を書いた");
    assert.ok(sc(okR).findings.some((f) => f.level === "warning"), "警告（formula.rawHtml など）を返す");

    const again = await s.call("pcraft_save_settings", saveInput(root, "settings/APP3740-見積書-見積書.json"));
    assert.equal(again.isError, true);
    assert.deepEqual([sc(again).status, sc(again).error.code], ["conflict", "ConflictError"]);

    const bad = await s.call("pcraft_save_settings", saveInput(root, "settings/壊れた.json", settings({ pluginID: "other" })));
    assert.deepEqual([sc(bad).status, sc(bad).error.code], ["invalid", "NormalizeError"]);
    assert.ok(sc(bad).findings.some((f) => f.level === "error"));
    assert.ok(!existsSync(path.join(root, "settings", "壊れた.json")));

    const noFields = await s.call("pcraft_save_settings", saveInput(root, "settings/a.json", undefined, { fields: "fields/9999.json" }));
    assert.deepEqual([sc(noFields).status, sc(noFields).error.code], ["invalid", "InputError"], "項目定義のファイルが無いのは入力の誤り");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("denied（作業フォルダーの外、未登録の workspaceId、接続のファイルに無い profile のフォルダー、接続のファイルが無いときの kintone/、ダウンロードの名前）", { skip }, async () => {
  const root = makeWorkspace();
  const other = makeWorkspace("pcraft-mcp-other-");
  const conn = makeConn();
  const stageDir = path.join(root, "kintone", "stage", "3740-見積書");
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(path.join(stageDir, "fields.json"), FIELDS_TEXT);
  const s = await connectClaudeCode([root], connEnv(conn.file));
  try {
    const outside = await s.call("pcraft_save_settings", saveInput(root, "../x.json"));
    assert.deepEqual([sc(outside).status, sc(outside).error.code], ["denied", "PathError"]);
    const unregistered = await s.call("pcraft_save_settings", saveInput(other, "settings/a.json"));
    assert.deepEqual([sc(unregistered).status, sc(unregistered).error.code], ["denied", "WorkspaceError"]);
    assert.match(sc(unregistered).error.message, /登録済みの作業フォルダーでない/, "フックが再接続の案内に置き換える文");
    const stage = await s.call("pcraft_save_settings", { workspaceId: root, path: "kintone/stage/3740-見積書/新しい帳票.json", content: settings(), expectedAbsent: true });
    assert.deepEqual([sc(stage).status, sc(stage).error.code], ["denied", "PermissionError"]);
    assert.match(sc(stage).error.message, /profile「stage」は接続のファイル（ksql\.config\.json）に無い/);
    const snap = await s.call("pcraft_save_settings", saveInput(root, "settings/rex0220-print-craft-app3740-20261005-125115.json"));
    assert.equal(sc(snap).status, "denied");
    for (const p of ["x.json", "settings/a.json", "kintone/stage/3740-見積書/新しい帳票.json"]) assert.ok(!existsSync(path.join(root, p)) && !existsSync(path.join(other, p)), p);
  } finally {
    await s.close();
  }
  // 接続のファイルが無いときは kintone/ の下をいつも変えない（古い形のフォルダーを取り違えない。15.7）
  const s2 = await connectClaudeCode([root]);
  try {
    const noConn = await s2.call("pcraft_save_settings", { workspaceId: root, path: "kintone/dev/3740-見積書/新しい帳票.json", content: settings(), fields: "fields/3740.json", expectedAbsent: true });
    assert.deepEqual([sc(noConn).status, sc(noConn).error.code], ["denied", "PermissionError"]);
    assert.match(sc(noConn).error.message, /kintone の接続のファイルがあるときだけ/);
    assert.ok(!existsSync(path.join(root, "kintone", "dev")));
  } finally {
    await s2.close();
    conn.cleanup();
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("入力の検査: workspaceId が無い・expectedAbsent が false・知らない引数は誤り（保存しない）", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    const { workspaceId: _omit, ...noWs } = saveInput(root, "settings/a.json");
    for (const input of [noWs, saveInput(root, "settings/a.json", undefined, { expectedAbsent: false }), saveInput(root, "settings/a.json", undefined, { overwrite: true })]) {
      const r = await s.call("pcraft_save_settings", input);
      assert.equal(r.isError, true, JSON.stringify(input).slice(0, 80));
    }
    assert.ok(!existsSync(path.join(root, "settings", "a.json")));
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed: 印刷屋の zip が未設定・相対パス・zip でない（保存しない）。未設定なら pcraft_status の next に出る", { skip }, async () => {
  const root = makeWorkspace();
  const notZip = path.join(root, "not-a-zip.zip");
  writeFileSync(notZip, "not a zip");
  try {
    for (const [env, re] of [[{}, /zip が未設定/], [{ PCRAFT_PLUGIN_ZIP: "zips/print-craft.zip" }, /絶対パス/], [{ PCRAFT_PLUGIN_ZIP: notZip }, /./]]) {
      const s = await connectClaudeCode([root], env);
      try {
        const r = await s.call("pcraft_save_settings", saveInput(root, "settings/a.json"));
        assert.equal(sc(r).status, "failed", JSON.stringify(sc(r)));
        assert.match(sc(r).error.message, re);
        if (!env.PCRAFT_PLUGIN_ZIP) assert.match(sc(await s.call("pcraft_status", {})).result.next.join("\n"), /zip が未設定/);
      } finally {
        await s.close();
      }
    }
    assert.ok(!existsSync(path.join(root, "settings", "a.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("設定項目が置き換えられずに ${user_config.…} の字のまま届いても未設定として扱う（作業フォルダーの .env の zip を使う）", { skip }, async () => {
  const root = makeWorkspace();
  writeFileSync(path.join(root, ".env"), `PCRAFT_PLUGIN_ZIP=${ZIP}\n`);
  const s = await connect(["--surface", "claude-code", "--roots", "${user_config.workspaceRoots}"], { PCRAFT_PLUGIN_ZIP: "${user_config.pluginZip}" });
  try {
    const st = sc(await s.call("pcraft_status", {}));
    assert.equal(st.result.workspace.registered, 0);
    assert.equal(st.result.pluginZip.configured, false);
  } finally {
    await s.close();
  }
  const s2 = await connectClaudeCode([root], { PCRAFT_PLUGIN_ZIP: "${user_config.pluginZip}" });
  try {
    const r = await s2.call("pcraft_save_settings", saveInput(root, "settings/a.json"));
    assert.equal(sc(r).status, "ok", JSON.stringify(sc(r)));
  } finally {
    await s2.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("desktop: 作業フォルダーが無ければ最後の 1 段だけ作る（\" と ~/ も）。workspaceId は省略できる。違えば denied。すぐ上が無ければ作らない", { skip }, async () => {
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-desk-")));
  const fresh = path.join(parent, "workspace");
  const conn = makeConn();
  try {
    const s = await connectDesktop(`"${fresh}"`, connEnv(conn.file));
    try {
      assert.ok(existsSync(fresh));
      const st = sc(await s.call("pcraft_status", {}));
      assert.deepEqual(st.result.workspace, { configured: true, name: "workspace" });
      assert.equal(st.result.ready, true);
      mkdirSync(path.join(fresh, "fields"));
      writeFileSync(path.join(fresh, "fields", "3740.json"), FIELDS_TEXT);
      const { workspaceId: _omit, ...input } = saveInput(fresh, "settings/見積書.json");
      assert.equal(sc(await s.call("pcraft_save_settings", input)).status, "ok");
      const wrong = await s.call("pcraft_save_settings", saveInput(parent, "settings/別.json"));
      assert.deepEqual([sc(wrong).status, sc(wrong).error.code], ["denied", "WorkspaceError"]);
    } finally {
      await s.close();
    }
    assert.match(s.stderr?.() ?? "", /./);
    const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-home-")));
    try {
      const s2 = await connect(["--surface", "desktop", "--workspace-dir", "~/pcraft-desktop"], { PCRAFT_PLUGIN_ZIP: ZIP, HOME: home, USERPROFILE: home });
      try {
        assert.deepEqual(sc(await s2.call("pcraft_status", {})).result.workspace, { configured: true, name: "pcraft-desktop" });
      } finally {
        await s2.close();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
    const deep = path.join(parent, "no-parent", "workspace");
    const s3 = await connectDesktop(deep);
    try {
      assert.ok(!existsSync(path.join(parent, "no-parent")), "深いところまで作らない");
      const st = sc(await s3.call("pcraft_status", {}));
      assert.equal(st.result.ready, false);
      assert.match(st.result.next.join("\n"), /すぐ上のフォルダー/);
      const { workspaceId: _omit, ...input } = saveInput(deep, "settings/a.json");
      assert.equal(sc(await s3.call("pcraft_save_settings", input)).status, "denied");
    } finally {
      await s3.close();
    }
  } finally {
    conn.cleanup();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("秘密の値（接続のファイルのトークン、環境変数の API トークン）を応答・標準エラーに出さない", { skip }, async () => {
  const root = makeWorkspace();
  const conn = makeConn();
  const s = await connectClaudeCode([root], connEnv(conn.file));
  try {
    await s.call("pcraft_status", {});
    await s.call("pcraft_workspace_status", { workspaceId: root });
    await s.call("pcraft_save_settings", saveInput(root, "settings/a.json"));
    await s.call("pcraft_save_settings", saveInput(root, "../b.json"));
    assert.ok(!s.output().includes(SECRET));
    assert.deepEqual(leakedTokens(s.output()), []);
    assert.match(s.stderr(), /kintoneConfig=設定済み（ksql\.config\.json）/, "起動の行に接続のファイルの名前（手での確認 7）");
    assert.ok(!s.stderr().includes(conn.dir), "接続のファイルのパスは出さない");
  } finally {
    await s.close();
    conn.cleanup();
  }
  const s2 = await connectClaudeCode([root]);
  try {
    await s2.call("pcraft_status", {});
    assert.match(s2.stderr(), /kintoneConfig=未設定/);
  } finally {
    await s2.close();
    rmSync(root, { recursive: true, force: true });
  }
});
