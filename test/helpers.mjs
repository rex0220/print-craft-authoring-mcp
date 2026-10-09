// 試験の共通: 束ねた print-craft MCP（dist/server/index.cjs）を MCP のクライアント（SDK v2）で起動して話す。
// 印刷屋の zip は環境変数 PCRAFT_TEST_PLUGIN_ZIP か、隣の print-craft の dist/print-craft-plugin7.zip（無ければ試験を飛ばす）
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

/** サーバーを起動してクライアントでつなぐ。応答と標準エラーを集める（秘密の値が出ないかの確かめ） */
export async function connect(args, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER, ...args],
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
export const connectClaudeCode = (roots, env = { PCRAFT_PLUGIN_ZIP: ZIP }) => connect(["--surface", "claude-code", "--roots", JSON.stringify(roots)], env);
/** Desktop の形（--surface desktop --workspace-dir …）で起動 */
export const connectDesktop = (dir, env = { PCRAFT_PLUGIN_ZIP: ZIP }) => connect(["--surface", "desktop", "--workspace-dir", dir], env);

export const sc = (r) => r.structuredContent;
export const saveInput = (root, p, content = SETTINGS_TEXT, extra = {}) => ({ workspaceId: root, path: p, content, fields: "fields/3740.json", expectedAbsent: true, ...extra });
