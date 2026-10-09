// 段階 0-3b の試作: .mcpb の検査（0-4 の verify-mcpb.mjs を元にした）。
//   1. zip を開いて、要るファイルと manifest の値（版、起動の形、設定項目の種類）、入れてはいけないものが無いことを確かめる
//   2. 展開して、Desktop と同じ形（node server/index.cjs + 引数 + 環境変数、起動の場所はドライブのいちばん上）で起動し、
//      MCP のクライアント（SDK v2）で話す: 指示の 1 行目に版、ツールの一覧が manifest と同じ、pcraft_status、保存の ok / conflict / denied
// 使い方: node build.mjs && node build-mcpb.mjs && node verify-mcpb.mjs（印刷屋の zip は隣の print-craft の dist/print-craft-plugin7.zip）
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpbPath = path.join(here, "dist-mcpb", "print-craft-proto.mcpb");
const tmp = path.resolve(here, "../../.tmp/mcpb-verify-0-3b");
const ZIP = path.resolve(here, "../../../print-craft/dist/print-craft-plugin7.zip");
const TOOLS = path.resolve(here, "../../../print-craft-authoring/tools");

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function readZip(file) {
  const zip = readFileSync(file);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert(eocd >= 0, "zip の終わりの目印が無い");
  const count = zip.readUInt16LE(eocd + 10);
  let off = zip.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert(zip.readUInt32LE(off) === 0x02014b50, "zip の中央ディレクトリが壊れている");
    const method = zip.readUInt16LE(off + 10);
    const size = zip.readUInt32LE(off + 20);
    const nameLen = zip.readUInt16LE(off + 28);
    const extraLen = zip.readUInt16LE(off + 30);
    const commentLen = zip.readUInt16LE(off + 32);
    const localOff = zip.readUInt32LE(off + 42);
    const name = zip.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    assert(method === 0, `${name} が無圧縮でない`);
    const dataOff = localOff + 30 + zip.readUInt16LE(localOff + 26) + zip.readUInt16LE(localOff + 28);
    entries.set(name, zip.subarray(dataOff, dataOff + size));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function main() {
  assert(existsSync(ZIP), `印刷屋の zip が無い: ${ZIP}`);
  const entries = readZip(mcpbPath);
  const expected = ["manifest.json", "server/index.cjs", "server/print-craft-mcp.cjs", "vendor/moment-with-locales.min.js", "vendor/moment.json", "README.md"];
  assert(JSON.stringify([...entries.keys()].sort()) === JSON.stringify([...expected].sort()), `中身が違う: ${[...entries.keys()].join(", ")}`);
  for (const p of entries.keys()) assert(!/(^|\/)(\.env|env\/|records\/|out\/|policy\/)/.test(p), `入れてはいけないもの: ${p}`);

  const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  const pkg = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"));
  assert(manifest.manifest_version === "0.3", "manifest_version");
  assert(manifest.version === pkg.version, "manifest の版が package.json と違う");
  assert(manifest.server?.type === "node" && manifest.server.entry_point === "server/index.cjs", "server の形");
  assert(manifest.server.mcp_config.args[0] === "${__dirname}/server/index.cjs", "起動のファイル");
  assert(manifest.server.mcp_config.env?.PCRAFT_PLUGIN_ZIP === "${user_config.pluginZip}", "印刷屋の zip は env で渡す");
  assert(manifest.user_config.workspaceDir?.type === "directory" && manifest.user_config.workspaceDir.required === true, "workspaceDir は必須のフォルダー");
  assert(manifest.user_config.pluginZip?.type === "file" && manifest.user_config.pluginZip.required === true, "pluginZip は必須のファイル");
  assert(JSON.stringify(manifest.compatibility?.platforms) === JSON.stringify(["darwin", "win32"]), "platforms");
  const launcher = entries.get("server/index.cjs").toString("utf8");
  assert(launcher.includes("main().catch") && !launcher.includes("require.main"), "起動のファイルは main() を必ず呼ぶ");
  const bundle = entries.get("server/print-craft-mcp.cjs").toString("utf8");
  assert(!/require\(["'](@modelcontextprotocol\/|zod|happy-dom)/.test(bundle), "依存を束ねていない");

  rmSync(tmp, { recursive: true, force: true });
  const bundleDir = path.join(tmp, "bundle");
  for (const [p, data] of entries) {
    mkdirSync(path.dirname(path.join(bundleDir, p)), { recursive: true });
    writeFileSync(path.join(bundleDir, p), data);
  }
  mkdirSync(tmp, { recursive: true });
  const workspace = path.join(realpathSync(tmp), "workspace"); // 無いフォルダー（最後の 1 段を作る）
  const argv = manifest.server.mcp_config.args.map((a) => a.replace("${__dirname}", bundleDir).replace("${user_config.workspaceDir}", workspace));
  const env = { PATH: process.env.PATH ?? "", PCRAFT_PLUGIN_ZIP: manifest.server.mcp_config.env.PCRAFT_PLUGIN_ZIP.replace("${user_config.pluginZip}", ZIP) };
  const transport = new StdioClientTransport({ command: process.execPath, args: argv, env, cwd: path.parse(process.cwd()).root, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d));
  const client = new Client({ name: "verify-mcpb-0-3b", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  try {
    const instructions = client.getInstructions?.() ?? client.getDiscoverResult?.()?.instructions;
    assert(String(instructions).split("\n")[0].includes(`試作 0-3b ${manifest.version}`), "指示の 1 行目に版");
    const { tools } = await client.listTools();
    assert(JSON.stringify(tools.map((t) => t.name)) === JSON.stringify(manifest.tools.map((t) => t.name)), "ツールの一覧が manifest と違う");
    assert(tools.every((t) => t.inputSchema?.additionalProperties === false), "inputSchema は additionalProperties: false");
    const st = (await client.callTool({ name: "pcraft_status", arguments: {} })).structuredContent;
    assert(st.result.ready === true && st.result.workspace.path === workspace && existsSync(workspace), `作業フォルダーを作って準備ができた: ${JSON.stringify(st.result.next)}`);
    const { FIELDS_FILE, aiSettings } = await import(pathToFileURL(path.join(TOOLS, "test", "fixtures.mjs")).href);
    mkdirSync(path.join(workspace, "fields"));
    writeFileSync(path.join(workspace, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
    const input = { path: "settings/APP3740-見積書-見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true };
    const ok = (await client.callTool({ name: "pcraft_save_settings", arguments: input })).structuredContent;
    assert(ok.status === "ok" && existsSync(path.join(workspace, input.path)), `保存できる（settings/ が無い作業フォルダー）: ${JSON.stringify(ok)}`);
    const again = (await client.callTool({ name: "pcraft_save_settings", arguments: input })).structuredContent;
    assert(again.status === "conflict", "同じ名前は conflict");
    const out = (await client.callTool({ name: "pcraft_save_settings", arguments: { ...input, path: "../x.json" } })).structuredContent;
    assert(out.status === "denied", "作業フォルダーの外は denied");
  } finally {
    await client.close();
  }
  assert(stderr.includes("作業フォルダーを作った"), "作ったことは標準エラーに出す（Desktop の main.log）");
  console.log(`[verify-mcpb] ok（${path.basename(mcpbPath)} ${manifest.version}、node ${process.version} で起動。Desktop の Node の版は手で確かめる）`);
}

main().catch((e) => {
  console.error(`[verify-mcpb] ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
