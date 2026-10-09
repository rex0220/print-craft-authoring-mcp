// 試験の共通: 束ねた print-craft MCP（dist/server/index.cjs）を MCP のクライアント（SDK v2）で起動して話す。
// 印刷屋の zip は環境変数 PCRAFT_TEST_PLUGIN_ZIP か、隣の print-craft の dist/print-craft-plugin7.zip（無ければ試験を飛ばす）。
// kintone の接続のファイル（kSQL の ksql.config.json の形。実装案 15 章）は作業フォルダーの外の一時フォルダーに置く（makeConn）
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const SERVER = path.join(ROOT, "dist", "server", "index.cjs");
export const VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
export const ZIP = process.env.PCRAFT_TEST_PLUGIN_ZIP ?? path.resolve(ROOT, "../print-craft/dist/print-craft-plugin7.zip");
export const SKIP = !existsSync(ZIP) && `印刷屋の zip が無い: ${ZIP}（PCRAFT_TEST_PLUGIN_ZIP で指定できる）`;
export const SECRET = "TEST-not-a-real-token-0123456789";
export const FIELDS_TEXT = readFileSync(path.join(here, "fixtures", "fields-3740.json"), "utf8");
export const SETTINGS_TEXT = readFileSync(path.join(here, "fixtures", "settings-mitsumori.json"), "utf8");
export const settings = (overrides = {}) => JSON.stringify({ ...JSON.parse(SETTINGS_TEXT), ...overrides });
/** 試験の実行の場所で決まる値を避けるため、起動の場所はドライブのいちばん上（Desktop と同じ。作業フォルダーには使わない） */
const SPAWN_CWD = path.parse(process.cwd()).root;

/** 作業フォルダー（実際のパス）。fields/3740.json を置く */
export function makeWorkspace(prefix = "pcraft-mcp-") {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  mkdirSync(path.join(root, "fields"));
  writeFileSync(path.join(root, "fields", "3740.json"), FIELDS_TEXT);
  return root;
}

/** 試験のときだけ kintone の偽物を読み込ませる（Node の --import。test/mock-fetch.mjs） */
export const MOCK_FETCH = pathToFileURL(path.join(here, "mock-fetch.mjs")).href;

/** サーバーを起動してクライアントでつなぐ。応答と標準エラーを集める（秘密の値が出ないかの確かめ）。opt.mockFetch で kintone の偽物、opt.server で別に作った本体 */
export async function connect(args, env = {}, opt = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...(opt.mockFetch ? ["--import", MOCK_FETCH] : []), opt.server ?? SERVER, ...args],
    env: { PATH: process.env.PATH ?? "", KINTONE_API_TOKEN: SECRET, ...env },
    cwd: SPAWN_CWD,
    stderr: "pipe"
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d));
  const client = new Client({ name: "print-craft-mcp-test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  const seen = [];
  const call = async (name, input) => {
    try {
      const r = await client.callTool({ name, arguments: input });
      seen.push(JSON.stringify(r));
      return r;
    } catch (e) {
      seen.push(String(e));
      return { isError: true, protocolError: e instanceof Error ? e.message : String(e) };
    }
  };
  return { client, call, close: () => client.close(), output: () => `${seen.join("\n")}\n${stderr}`, stderr: () => stderr };
}

/** Claude Code の形（--surface claude-code --roots [...]）で起動 */
export const connectClaudeCode = (roots, env = { PCRAFT_PLUGIN_ZIP: ZIP }, opt = {}) => connect(["--surface", "claude-code", "--roots", JSON.stringify(roots)], env, opt);
/** Desktop の形（--surface desktop --workspace-dir …）で起動 */
export const connectDesktop = (dir, env = { PCRAFT_PLUGIN_ZIP: ZIP }, opt = {}) => connect(["--surface", "desktop", "--workspace-dir", dir], env, opt);

export const sc = (r) => r.structuredContent;

/** 接続のファイルに直接書く試験のトークン（応答・標準エラーに出てはいけない） */
export const TOKENS = { dev3740: "TEST-dev-3740-not-a-real-token", dev101: "TEST-dev-101-not-a-real-token", prod3740: SECRET, guest3740: "TEST-guest-3740-not-a-real-token" };
/** 開発（dev-x）と本番（x）とゲストスペース 7（x）。dev の APP101 は env:（PCRAFT_TEST_TOKEN_101） */
export const CONN = {
  defaultProfile: "dev",
  profiles: {
    dev: { baseUrl: "https://dev-x.cybozu.com", tokenMap: { APP3740: TOKENS.dev3740, APP101: "env:PCRAFT_TEST_TOKEN_101", APP9999: TOKENS.dev3740 } },
    prod: { baseUrl: "https://x.cybozu.com", tokenMap: { APP3740: TOKENS.prod3740 } },
    guest7: { baseUrl: "https://x.cybozu.com", guestSpaceId: 7, tokenMap: { "3740": TOKENS.guest3740 } }
  }
};

/** kintone の接続のファイル（作業フォルダーの外の一時フォルダー）。write で書き換える */
export function makeConn(conn = CONN) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-conn-")));
  const file = path.join(dir, "ksql.config.json");
  const write = (data) => writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data), { mode: 0o600 });
  write(conn);
  return { dir, file, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 接続のファイルを使うときの環境変数（OS の KINTONE_* は読まないことも確かめるため、別の接続先を入れておく） */
export const connEnv = (file, extra = {}) => ({ PCRAFT_PLUGIN_ZIP: ZIP, PCRAFT_KINTONE_CONFIG: file, PCRAFT_TEST_TOKEN_101: TOKENS.dev101, KINTONE_BASE_URL: "https://other.cybozu.com", ...extra });

/** 偽の kintone が記録するトークンの短い digest（トークンそのものはログに書かない） */
export const tokenHash = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16);

/** 偽の kintone の要求のログ（PCRAFT_TEST_FETCH_LOG） */
export function fetchLog() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-fetchlog-")));
  const file = path.join(dir, "fetch.log");
  return { file, requests: () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 秘密の値（試験のトークンすべて）が出ていないか */
export const leakedTokens = (text) => Object.values(TOKENS).filter((t) => text.includes(t));
export const saveInput = (root, p, content = SETTINGS_TEXT, extra = {}) => ({ workspaceId: root, path: p, content, fields: "fields/3740.json", expectedAbsent: true, ...extra });
