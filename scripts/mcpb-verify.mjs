// .mcpb の検査（実装案 8.3。試作 0-3b / 0-4 と kSQL の mcpb-verify.mjs を元にした）。
//   1. zip を開いて、要るファイル・入れてはいけないもの（scripts/forbidden-files.mjs）・manifest の値（版、起動の形、設定項目の種類、秘密の値は env で渡すこと、配布元とプライバシーポリシー）、
//      THIRD_PARTY_NOTICES.md がリポジトリのものと同じこと
//   2. 展開して、Desktop と同じ形（node server/index.cjs + 引数 + 環境変数、起動の場所はドライブのいちばん上）で起動し、MCP のクライアント（SDK v2）で話す:
//      指示の 1 行目に版、ツールの一覧が manifest と同じ（厳しいスキーマ）、pcraft_docs の目次、pcraft_status、pcraft_workspace_status、保存の ok / conflict / denied、
//      kintone の接続のファイル（作業フォルダーの外）に書いた試験用の API トークンが引数・応答・標準エラーに出ないこと
// 使い方: node build-mcp.mjs && node build-mcpb.mjs && node scripts/mcpb-verify.mjs（印刷屋の zip は PCRAFT_TEST_PLUGIN_ZIP か隣の print-craft の dist/print-craft-plugin7.zip）
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { REPO_URL } from "../build-mcpb.mjs";
import { problemsOf } from "./forbidden-files.mjs";
import { eol, NOTICES_FILE } from "./third-party-notices.mjs";
import { readZip } from "./zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpbPath = path.join(root, "dist-mcpb", "print-craft.mcpb");
const tmp = path.join(root, ".tmp", "mcpb-verify");
const ZIP = process.env.PCRAFT_TEST_PLUGIN_ZIP ?? path.resolve(root, "../print-craft/dist/print-craft-plugin7.zip");
const TEST_TOKEN = "TEST-not-a-real-token-0123456789"; // 本物の資格情報は使わない

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  assert(existsSync(ZIP), `印刷屋の zip が無い: ${ZIP}`);
  const entries = readZip(mcpbPath);
  const expected = ["manifest.json", "server/index.cjs", "server/print-craft-mcp.cjs", "vendor/moment-with-locales.min.js", "vendor/moment.json", "LICENSE", NOTICES_FILE, "README.md"];
  assert(JSON.stringify([...entries.keys()].sort()) === JSON.stringify([...expected].sort()), `中身が違う: ${[...entries.keys()].join(", ")}`);
  const problems = problemsOf(entries);
  assert(!problems.length, `入れてはいけないもの:\n  ${problems.join("\n  ")}`);
  assert(eol(entries.get(NOTICES_FILE).toString("utf8")) === eol(readFileSync(path.join(root, NOTICES_FILE), "utf8")), `${NOTICES_FILE} がリポジトリのものと違う`);

  const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert(manifest.manifest_version === "0.3", "manifest_version");
  assert(manifest.version === pkg.version, "manifest の版が package.json と違う");
  assert(manifest.server?.type === "node" && manifest.server.entry_point === "server/index.cjs", "server の形");
  assert(manifest.server.mcp_config.args[0] === "${__dirname}/server/index.cjs", "起動のファイル");
  assert(!manifest.server.mcp_config.args.some((a) => /kintoneConfig|pluginZip/.test(a)), "zip と接続のファイルを引数に入れない（env で渡す）");
  assert(manifest.server.mcp_config.env?.PCRAFT_KINTONE_CONFIG === "${user_config.kintoneConfig}", "接続のファイルは env で渡す");
  assert(!Object.keys(manifest.server.mcp_config.env).some((k) => /^KINTONE_/.test(k)), "kintone の URL・トークンを設定項目で渡さない（接続のファイルだけ。15.4）");
  assert(manifest.user_config.workspaceDir?.type === "directory" && manifest.user_config.workspaceDir.required === true, "workspaceDir は必須のフォルダー");
  assert(manifest.user_config.pluginZip?.type === "file" && manifest.user_config.pluginZip.required === true, "pluginZip は必須のファイル");
  // 接続のファイルは任意（無ければ kintone を使わないツールだけが動く。r3 MAJOR 4）
  assert(manifest.user_config.kintoneConfig?.type === "file" && manifest.user_config.kintoneConfig.required === false, "kintoneConfig は任意のファイル");
  assert(JSON.stringify(Object.keys(manifest.user_config).sort()) === JSON.stringify(["kintoneConfig", "pluginZip", "workspaceDir"]), "設定項目は作業フォルダー・zip・接続のファイルだけ");
  for (const [k, v] of Object.entries(manifest.user_config)) assert((v.sensitive === true) === /token|password|username/i.test(k), `${k} の sensitive（秘密の値の項目だけ）`);
  const plugin = JSON.parse(readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
  for (const [k, v] of Object.entries(plugin.userConfig)) assert((v.sensitive === true) === /token|password|username/i.test(k), `プラグインの ${k} の sensitive（秘密の値の項目だけ）`);
  assert(JSON.stringify(manifest.compatibility?.platforms) === JSON.stringify(["darwin", "win32"]), "platforms");
  // 配布元とプライバシーポリシー（kintone に接続するので要る。リリース手順 0-5・0-8）
  assert(manifest.homepage === REPO_URL && manifest.repository?.type === "git" && manifest.repository.url === REPO_URL && manifest.support === `${REPO_URL}/issues`, "配布元（homepage、repository、support）");
  assert(JSON.stringify(manifest.privacy_policies) === JSON.stringify([`${REPO_URL}/blob/main/PRIVACY.md`]) && existsSync(path.join(root, "PRIVACY.md")), "privacy_policies は PRIVACY.md の https の URL");
  const launcher = entries.get("server/index.cjs").toString("utf8");
  assert(launcher.includes("main().catch") && !launcher.includes("require.main"), "起動のファイルは main() を必ず呼ぶ");
  const bundle = entries.get("server/print-craft-mcp.cjs").toString("utf8");
  assert(!/require\(["'](@modelcontextprotocol\/|zod|happy-dom|@rex0220\/)/.test(bundle), "依存を束ねていない");

  rmSync(tmp, { recursive: true, force: true });
  const bundleDir = path.join(tmp, "bundle");
  for (const [p, data] of entries) {
    mkdirSync(path.dirname(path.join(bundleDir, p)), { recursive: true });
    writeFileSync(path.join(bundleDir, p), data);
  }
  const workspace = path.join(realpathSync(tmp), "workspace"); // 無いフォルダー（最後の 1 段を作る）
  // kintone の接続のファイル（作業フォルダーの外。kSQL の形。トークンを直接書いた試験の値）
  const connFile = path.join(realpathSync(tmp), "ksql.config.json");
  writeFileSync(connFile, JSON.stringify({ defaultProfile: "dev", profiles: { dev: { baseUrl: "https://x.cybozu.com", tokenMap: { APP3740: TEST_TOKEN } } } }), { mode: 0o600 });
  const argv = manifest.server.mcp_config.args.map((a) => a.replace("${__dirname}", bundleDir).replace("${user_config.workspaceDir}", workspace));
  const env = { PATH: process.env.PATH ?? "" };
  for (const [k, v] of Object.entries(manifest.server.mcp_config.env)) {
    env[k] = v.replace("${user_config.pluginZip}", ZIP).replace("${user_config.kintoneConfig}", connFile);
  }
  const transport = new StdioClientTransport({ command: process.execPath, args: argv, env, cwd: path.parse(process.cwd()).root, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d));
  const client = new Client({ name: "mcpb-verify", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  const seen = [];
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    seen.push(JSON.stringify(r));
    return r;
  };
  try {
    const instructions = client.getInstructions?.() ?? client.getDiscoverResult?.()?.instructions;
    assert(String(instructions).split("\n")[0].startsWith(`print-craft MCP ${manifest.version}（`), "指示の 1 行目に版");
    const { tools } = await client.listTools();
    assert(JSON.stringify(tools.map((t) => t.name)) === JSON.stringify(manifest.tools.map((t) => t.name)), `ツールの一覧が manifest と違う: ${tools.map((t) => t.name).join(", ")}`);
    assert(tools.every((t) => t.inputSchema?.additionalProperties === false), "inputSchema は additionalProperties: false");
    // preview の MCP App（実装案 16 章）: pcraft_preview が表示の殻を指し、その資源がある
    assert(tools.find((t) => t.name === "pcraft_preview")?._meta?.ui?.resourceUri === "ui://print-craft/preview.html", "pcraft_preview の _meta.ui.resourceUri");
    const { resources } = await client.listResources();
    assert(resources.some((r) => r.uri === "ui://print-craft/preview.html" && r.mimeType === "text/html;profile=mcp-app"), "preview の表示の殻の資源");
    const docs = (await call("pcraft_docs", {})).content.map((c) => c.text).join("\n");
    assert(docs.startsWith(`print-craft MCP ${manifest.version}（`) && /資料の元: rex0220\/print-craft-authoring /.test(docs), "pcraft_docs の目次は版の行と資料の元で始まる");
    const st = (await call("pcraft_status", {})).structuredContent;
    assert(st.result.ready === true && st.result.workspace.name === path.basename(workspace) && existsSync(workspace), `作業フォルダーを作って準備ができた: ${JSON.stringify(st.result.next)}`);
    assert(st.result.pluginZip.readable === true && st.result.pluginZip.compatible === true, "印刷屋の zip を読めて互換");
    assert(!JSON.stringify(st).includes(workspace) && !JSON.stringify(st).includes(ZIP) && !JSON.stringify(st).includes(connFile), "診断は絶対パスを返さない");
    assert(st.result.capabilities?.kintone?.ready === true && st.result.capabilities.kintone.fileName === "ksql.config.json", `接続のファイルを読めた: ${JSON.stringify(st.result.capabilities)}`);
    const ws = (await call("pcraft_workspace_status", {})).structuredContent;
    assert(ws.status === "ok" && ws.result.mode === "profiles" && ws.result.connection.profiles?.[0]?.tokenApps?.[0]?.ready === true, `作業フォルダーの診断で profile が見える: ${JSON.stringify(ws.result.connection)}`);
    mkdirSync(path.join(workspace, "fields"));
    writeFileSync(path.join(workspace, "fields", "3740.json"), readFileSync(path.join(root, "test", "fixtures", "fields-3740.json")));
    const input = { path: "settings/APP3740-見積書-見積書.json", content: readFileSync(path.join(root, "test", "fixtures", "settings-mitsumori.json"), "utf8"), fields: "fields/3740.json", expectedAbsent: true };
    const okR = (await call("pcraft_save_settings", input)).structuredContent;
    assert(okR.status === "ok" && existsSync(path.join(workspace, input.path)), `保存できる（settings/ が無い作業フォルダー）: ${JSON.stringify(okR)}`);
    assert((await call("pcraft_save_settings", input)).structuredContent.status === "conflict", "同じ名前は conflict");
    assert((await call("pcraft_save_settings", { ...input, path: "../x.json" })).structuredContent.status === "denied", "作業フォルダーの外は denied");
  } finally {
    await client.close();
  }
  assert(!argv.some((a) => a.includes(TEST_TOKEN)) && !Object.values(env).some((v) => v.includes(TEST_TOKEN)), "引数と環境変数にトークンが無い（接続のファイルだけ）");
  assert(!seen.join("\n").includes(TEST_TOKEN), "応答にトークンが出ない");
  assert(!stderr.includes(TEST_TOKEN), "標準エラーにトークンが出ない");
  assert(stderr.includes("作業フォルダーを作った"), "作ったことは標準エラーに出す（Desktop の main.log）");
  assert(stderr.includes("kintoneConfig=設定済み（ksql.config.json）") && !stderr.includes(connFile), "起動の行に接続のファイルの名前だけ（パスは出さない）");
  console.log(`[mcpb-verify] ok（${path.basename(mcpbPath)} ${manifest.version}、ツール ${manifest.tools.length}、node ${process.version} で起動。Desktop の Node の版は手で確かめる）`);
}

main().catch((e) => {
  console.error(`[mcpb-verify] ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
