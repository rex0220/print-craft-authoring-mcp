// 段階 0-4 の試作: .mcpb の検査（依存なし。kintone-sql-tools の scripts/mcpb-verify.mjs を元にした）。
//   1. zip を開いて、要るファイルと manifest の値（版、起動の形、設定項目の種類、秘密の値は env で渡すこと）を確かめる
//   2. 展開して、Desktop と同じ形（node server/index.js + 引数 + 環境変数）で起動し、JSON-RPC で話す
//   3. instructions の 1 行目が版、ツールの一覧が manifest と同じ、pcraft_docs が文章だけ、
//      試験用のトークンが応答・標準出力・標準エラーに出ないこと、引数に紛れていないこと
// 使い方: node prototype/0-4/build-mcpb.mjs && node prototype/0-4/verify-mcpb.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mcpbPath = join(here, "dist-mcpb", "print-craft-proto.mcpb");
const tmp = resolve(here, "../../.tmp/mcpb-verify");
const TEST_TOKEN = "TEST-not-a-real-token-0123456789"; // 本物の資格情報は使わない（実装案 9 章 0-4）

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

/** Desktop と同じ形で起動して、行ごとの JSON-RPC で話す */
async function talk(serverDir, manifest, workspaceDir) {
  const argv = manifest.server.mcp_config.args.map(a =>
    a
      .replace("${__dirname}", serverDir)
      .replace("${user_config.workspaceDir}", workspaceDir)
      .replace("${user_config.pluginZip}", "")
      .replace("${user_config.kintoneBaseUrl}", "")
  );
  const env = { ...process.env };
  for (const [k, v] of Object.entries(manifest.server.mcp_config.env)) env[k] = v.replace("${user_config.kintoneApiToken}", TEST_TOKEN);
  const child = spawn(process.execPath, argv, { cwd: "/", env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  const waiters = new Map();
  child.stdout.on("data", d => {
    out += d;
    for (const line of d.toString().split("\n")) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      waiters.get(msg.id)?.(msg);
    }
  });
  child.stderr.on("data", d => (err += d));
  let id = 0;
  const call = (method, params) =>
    new Promise((res, rej) => {
      const n = ++id;
      const timer = setTimeout(() => rej(new Error(`${method} が時間切れ（起動のファイルが main() を呼んでいない？）`)), 5000);
      waiters.set(n, m => {
        clearTimeout(timer);
        res(m);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    });
  try {
    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify", version: "0" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const tools = await call("tools/list", {});
    const docs = await call("tools/call", { name: "pcraft_docs", arguments: {} });
    const status = await call("tools/call", { name: "pcraft_status", arguments: {} });
    const ws = await call("tools/call", { name: "pcraft_workspace_status", arguments: {} });
    const wrongWs = await call("tools/call", { name: "pcraft_workspace_status", arguments: { workspaceId: "/elsewhere" } });
    return { init: init.result, tools: tools.result.tools, docs: docs.result, status: status.result, ws: ws.result, wrongWs: wrongWs.result, argv };
  } finally {
    child.kill();
    await new Promise(r => setTimeout(r, 50));
    globalThis.__out = out;
    globalThis.__err = err;
  }
}

async function main() {
  const entries = readZip(mcpbPath);
  for (const p of ["manifest.json", "server/index.js", "server/hello.cjs", "README.md"]) assert(entries.has(p), `${p} が無い`);
  for (const p of entries.keys()) assert(!/(^|\/)(\.env|env\/|records\/|out\/)/.test(p), `入れてはいけないもの: ${p}`);

  const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  assert(manifest.manifest_version === "0.3", "manifest_version");
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "version が semver でない");
  assert(manifest.server?.type === "node" && manifest.server.entry_point === "server/index.js", "server の形");
  assert(manifest.server.mcp_config.command === "node", "command");
  assert(manifest.server.mcp_config.args.includes("${__dirname}/server/index.js"), "起動のファイル");
  assert(!manifest.server.mcp_config.args.some(a => a.includes("kintoneApiToken")), "秘密の値を引数に入れていない");
  assert(manifest.server.mcp_config.env?.KINTONE_API_TOKEN === "${user_config.kintoneApiToken}", "秘密の値を env で渡す");
  assert(manifest.user_config.workspaceDir?.type === "directory" && manifest.user_config.workspaceDir.required === true, "workspaceDir は必須のフォルダー");
  assert(manifest.user_config.kintoneApiToken?.sensitive === true, "API トークンは sensitive");
  assert(manifest.user_config.pluginZip?.type === "file", "pluginZip はファイル");
  assert(JSON.stringify(manifest.compatibility?.platforms) === JSON.stringify(["darwin", "win32"]), "platforms");
  assert(manifest.compatibility?.runtimes?.node === ">=20.0.0", "runtimes.node");

  const launcher = entries.get("server/index.js").toString("utf8");
  assert(launcher.includes("main().catch") && !launcher.includes("require.main"), "起動のファイルは main() を必ず呼ぶ");

  rmSync(tmp, { recursive: true, force: true });
  const serverDir = join(tmp, "bundle");
  const workspaceDir = join(tmp, "workspace");
  mkdirSync(join(serverDir, "server"), { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  for (const p of ["server/index.js", "server/hello.cjs"]) writeFileSync(join(serverDir, p), entries.get(p));

  const r = await talk(serverDir, manifest, workspaceDir);
  assert(String(r.init.instructions).split("\n")[0].includes(manifest.version), "instructions の 1 行目に版");
  assert(JSON.stringify(r.tools.map(t => t.name)) === JSON.stringify(manifest.tools.map(t => t.name)), "ツールの一覧が manifest と違う");
  assert(r.tools.every(t => t.inputSchema?.additionalProperties === false), "inputSchema は additionalProperties: false");
  assert(r.docs.content?.length === 1 && r.docs.content[0].type === "text" && !("structuredContent" in r.docs), "pcraft_docs は文章だけ");
  assert(r.docs.content[0].text.startsWith("print-craft MCP"), "pcraft_docs の目次は版の行で始まる");
  const st = r.status.structuredContent.result;
  assert(st.token.set === true && st.token.length === TEST_TOKEN.length && st.token.appearsInArgv === false, "トークンは env で届き、引数に無い");
  assert(st.cwd === "/", "cwd は起動の場所のまま（使わない）");
  assert(r.ws.structuredContent?.ok === true, "作業フォルダーは起動時に固定");
  assert(r.wrongWs.isError === true, "別の workspaceId は拒否");
  assert(!r.argv.some(a => a.includes(TEST_TOKEN)), "引数にトークンが無い");
  assert(!globalThis.__out.includes(TEST_TOKEN), "標準出力（応答）にトークンが出ない");
  assert(!globalThis.__err.includes(TEST_TOKEN), "標準エラーにトークンが出ない");

  // 作業フォルダーが無ければ作る: すぐ上のフォルダーがあるときだけ、最後の 1 段だけ（実装案 4.1。2026-10-09 Takashi）
  const fresh = join(tmp, "fresh-workspace");
  const r2 = await talk(serverDir, manifest, fresh);
  const st2 = r2.status.structuredContent.result;
  assert(st2.workspaceCreated === true && st2.workspace !== null && existsSync(fresh), "すぐ上のフォルダーがあれば、無い作業フォルダーを作る");
  const deep = join(tmp, "no-parent", "deeper", "workspace");
  const r3 = await talk(serverDir, manifest, deep);
  const st3 = r3.status.structuredContent.result;
  assert(st3.workspace === null && st3.workspaceCreated === false && !existsSync(join(tmp, "no-parent")), "すぐ上のフォルダーが無ければ作らない（深いところまで作らない）");
  assert(r3.ws.isError === true, "作業フォルダーが無いときは作業フォルダーを使うツールを止める");
  const fileAsWs = join(tmp, "a-file");
  writeFileSync(fileAsWs, "x");
  const r4 = await talk(serverDir, manifest, fileAsWs);
  assert(r4.status.structuredContent.result.workspace === null, "同じ名前のファイルがあれば作業フォルダーにしない");

  console.log(`[verify-mcpb] ok（node ${process.version} で起動。Desktop の Node の版は手で確かめる）`);
}

main().catch(e => {
  console.error(`[verify-mcpb] ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
