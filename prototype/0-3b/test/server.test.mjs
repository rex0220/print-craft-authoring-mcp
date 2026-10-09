// 段階 0-3b の試作の試験: 束ねた print-craft MCP（dist/server/index.cjs）を MCP のクライアント（SDK v2）で起動して話す。
// 確かめること（実装案 9 章 0-3b）: ok / conflict / denied / invalid / failed が 5.2 の約束どおりか、作業フォルダーの結び付け（4.1）、
// 入力の厳しいスキーマ、秘密の値を出さないこと。印刷屋の zip は隣の print-craft の dist/print-craft-plugin7.zip（無ければ飛ばす）
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "../dist/server/index.cjs");
const TOOLS = path.resolve(here, "../../../../print-craft-authoring/tools");
const ZIP = path.resolve(here, "../../../../print-craft/dist/print-craft-plugin7.zip");
const VERSION = JSON.parse(readFileSync(path.resolve(here, "../package.json"), "utf8")).version;
const { FIELDS_FILE, aiSettings } = await import(pathToFileURL(path.join(TOOLS, "test", "fixtures.mjs")).href);
const skip = !existsSync(ZIP) && `印刷屋の zip が無い: ${ZIP}`;
const SECRET = "TEST-not-a-real-token-0123456789";

/** 作業フォルダー（実際のパス）。settings/ と fields/3740.json を置く */
function makeWorkspace(prefix = "pcraft-0-3b-") {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  mkdirSync(path.join(root, "settings"));
  mkdirSync(path.join(root, "fields"));
  writeFileSync(path.join(root, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
  return root;
}

/** サーバーを起動してクライアントでつなぐ。標準エラーも集める */
async function connect(args, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER, ...args],
    env: { PATH: process.env.PATH ?? "", KINTONE_API_TOKEN: SECRET, ...env },
    cwd: path.parse(process.cwd()).root, // Desktop と同じく起動の場所はドライブのいちばん上（使わないことを確かめる）
    stderr: "pipe"
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d));
  const client = new Client({ name: "pcraft-0-3b-test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  const seen = [];
  const call = async (name, args2) => {
    try {
      const r = await client.callTool({ name, arguments: args2 });
      seen.push(JSON.stringify(r));
      return r;
    } catch (e) {
      seen.push(String(e));
      return { isError: true, protocolError: e instanceof Error ? e.message : String(e) };
    }
  };
  return { client, call, close: () => client.close(), output: () => `${seen.join("\n")}\n${stderr}` };
}

const save = (root, p, content = JSON.stringify(aiSettings()), extra = {}) => ({ workspaceId: root, path: p, content, fields: "fields/3740.json", expectedAbsent: true, ...extra });
const sc = (r) => r.structuredContent;

test("claude-code: ツールは 2 つ。入力は厳しいスキーマ（additionalProperties: false、workspaceId は必須）。指示の 1 行目に版", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connect(["--surface", "claude-code", "--roots", JSON.stringify([root])], { PCRAFT_PLUGIN_ZIP: ZIP });
  try {
    const { tools } = await s.client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["pcraft_status", "pcraft_save_settings"]);
    const saveTool = tools.find((t) => t.name === "pcraft_save_settings");
    assert.equal(saveTool.inputSchema.additionalProperties, false);
    assert.deepEqual([...saveTool.inputSchema.required].sort(), ["content", "expectedAbsent", "path", "workspaceId"]);
    assert.equal(tools.find((t) => t.name === "pcraft_status").annotations.readOnlyHint, true);
    const instructions = s.client.getInstructions?.() ?? s.client.getDiscoverResult?.()?.instructions;
    assert.match(String(instructions).split("\n")[0], new RegExp(`試作 0-3b ${VERSION.replace(/\./g, "\\.")}`));
    const st = sc(await s.call("pcraft_status", {}));
    assert.equal(st.result.ready, true, JSON.stringify(st.result.next));
    assert.deepEqual(st.result.workspace.registered, [root]);
    assert.equal(st.result.pluginZip.source, "設定項目");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("claude-code: 保存は ok（digest は確定したファイル）、同じ名前は conflict、normalize のエラーは invalid（保存しない）", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connect(["--surface", "claude-code", "--roots", JSON.stringify([root])], { PCRAFT_PLUGIN_ZIP: ZIP });
  try {
    const ok = await s.call("pcraft_save_settings", save(root, "settings/APP3740-見積書-見積書.json"));
    assert.equal(ok.isError, false, JSON.stringify(sc(ok)));
    assert.equal(sc(ok).status, "ok");
    const file = path.join(root, "settings", "APP3740-見積書-見積書.json");
    assert.equal(sc(ok).digest, createHash("sha256").update(readFileSync(file)).digest("hex"));
    assert.ok(JSON.parse(readFileSync(file, "utf8")).usedFields, "normalize の派生値を書いた");
    assert.ok(sc(ok).findings.every((f) => f.level !== "error"));

    const again = await s.call("pcraft_save_settings", save(root, "settings/APP3740-見積書-見積書.json"));
    assert.equal(again.isError, true);
    assert.equal(sc(again).status, "conflict");
    assert.equal(sc(again).error.code, "ConflictError");

    const bad = await s.call("pcraft_save_settings", save(root, "settings/壊れた.json", JSON.stringify(aiSettings({ pluginID: "other" }))));
    assert.equal(sc(bad).status, "invalid");
    assert.ok(sc(bad).findings.some((f) => f.level === "error"));
    assert.ok(!existsSync(path.join(root, "settings", "壊れた.json")));
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("claude-code: denied（作業フォルダーの外、未登録の workspaceId、本番のフォルダー、ダウンロードの名前）", { skip }, async () => {
  const root = makeWorkspace();
  const other = makeWorkspace("pcraft-0-3b-other-");
  writeFileSync(path.join(root, "environments.json"), JSON.stringify({ environments: { prod: { baseUrl: "https://x.cybozu.com", role: "production" } } }));
  const prodDir = path.join(root, "kintone", "x.cybozu.com", "3740-見積書");
  mkdirSync(prodDir, { recursive: true });
  writeFileSync(path.join(prodDir, "fields.json"), JSON.stringify(FIELDS_FILE));
  const s = await connect(["--surface", "claude-code", "--roots", JSON.stringify([root])], { PCRAFT_PLUGIN_ZIP: ZIP });
  try {
    const outside = await s.call("pcraft_save_settings", save(root, "../x.json"));
    assert.equal(sc(outside).status, "denied");
    const unregistered = await s.call("pcraft_save_settings", save(other, "settings/a.json"));
    assert.equal(sc(unregistered).status, "denied");
    assert.equal(sc(unregistered).error.code, "WorkspaceError");
    assert.match(sc(unregistered).error.message, /登録済みの作業フォルダーでない/, "フックが再接続の案内に置き換える文");
    const prod = await s.call("pcraft_save_settings", { workspaceId: root, path: "kintone/x.cybozu.com/3740-見積書/新しい帳票.json", content: JSON.stringify(aiSettings()), expectedAbsent: true });
    assert.equal(sc(prod).status, "denied");
    assert.match(sc(prod).error.message, /本番（role: production）/);
    const snap = await s.call("pcraft_save_settings", save(root, "settings/rex0220-print-craft-app3740-20261005-125115.json"));
    assert.equal(sc(snap).status, "denied");
    for (const p of ["x.json", "settings/a.json", "kintone/x.cybozu.com/3740-見積書/新しい帳票.json"]) assert.ok(!existsSync(path.join(root, p)) && !existsSync(path.join(other, p)), p);
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("入力の検査: workspaceId が無い・expectedAbsent が false・知らない引数は誤り（保存しない）", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connect(["--surface", "claude-code", "--roots", JSON.stringify([root])], { PCRAFT_PLUGIN_ZIP: ZIP });
  try {
    const { workspaceId: _omit, ...noWs } = save(root, "settings/a.json");
    for (const input of [noWs, save(root, "settings/a.json", undefined, { expectedAbsent: false }), save(root, "settings/a.json", undefined, { overwrite: true })]) {
      const r = await s.call("pcraft_save_settings", input);
      assert.equal(r.isError, true, JSON.stringify(input).slice(0, 80));
    }
    assert.ok(!existsSync(path.join(root, "settings", "a.json")));
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed: 印刷屋の zip が未設定・相対パス・zip でない（保存しない）", { skip }, async () => {
  const root = makeWorkspace();
  const notZip = path.join(root, "not-a-zip.zip");
  writeFileSync(notZip, "not a zip");
  try {
    for (const [env, re] of [[{}, /zip が未設定/], [{ PCRAFT_PLUGIN_ZIP: "zips/print-craft.zip" }, /絶対パス/], [{ PCRAFT_PLUGIN_ZIP: notZip }, /./]]) {
      const s = await connect(["--surface", "claude-code", "--roots", JSON.stringify([root])], env);
      try {
        const r = await s.call("pcraft_save_settings", save(root, "settings/a.json"));
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

test("desktop: 作業フォルダーが無ければ最後の 1 段だけ作る。workspaceId は省略できる。違えば denied。すぐ上が無ければ denied", { skip }, async () => {
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-0-3b-desk-")));
  const fresh = path.join(parent, "workspace");
  try {
    const s = await connect(["--surface", "desktop", "--workspace-dir", `"${fresh}"`], { PCRAFT_PLUGIN_ZIP: ZIP });
    try {
      assert.ok(existsSync(fresh), "作業フォルダーを作った（\" で囲んだパスも受け付ける）");
      const st = sc(await s.call("pcraft_status", {}));
      assert.deepEqual(st.result.workspace, { configured: true, path: fresh });
      assert.equal(st.result.ready, true);
      assert.ok(!("created" in st.result.workspace), "プロセスごとの印（作ったか）を応答に出さない");
      mkdirSync(path.join(fresh, "fields"));
      writeFileSync(path.join(fresh, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
      const { workspaceId: _omit, ...input } = save(fresh, "settings/見積書.json");
      const ok = await s.call("pcraft_save_settings", input);
      assert.equal(sc(ok).status, "ok", JSON.stringify(sc(ok)));
      const wrong = await s.call("pcraft_save_settings", save(parent, "settings/別.json"));
      assert.equal(sc(wrong).status, "denied");
      assert.equal(sc(wrong).error.code, "WorkspaceError");
    } finally {
      await s.close();
    }
    const deep = path.join(parent, "no-parent", "workspace");
    const s2 = await connect(["--surface", "desktop", "--workspace-dir", deep], { PCRAFT_PLUGIN_ZIP: ZIP });
    try {
      assert.ok(!existsSync(path.join(parent, "no-parent")), "深いところまで作らない");
      const st = sc(await s2.call("pcraft_status", {}));
      assert.equal(st.result.ready, false);
      assert.match(st.result.next.join("\n"), /すぐ上のフォルダー/);
      const { workspaceId: _omit, ...input } = save(deep, "settings/a.json");
      const r = await s2.call("pcraft_save_settings", input);
      assert.equal(sc(r).status, "denied");
    } finally {
      await s2.close();
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("秘密の値（環境変数の API トークン）を応答・標準エラーに出さない", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connect(["--surface", "claude-code", "--roots", JSON.stringify([root])], { PCRAFT_PLUGIN_ZIP: ZIP });
  try {
    await s.call("pcraft_status", {});
    await s.call("pcraft_save_settings", save(root, "settings/a.json"));
    await s.call("pcraft_save_settings", save(root, "../b.json"));
    assert.ok(!s.output().includes(SECRET));
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
