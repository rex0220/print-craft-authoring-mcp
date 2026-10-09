// 段階 0-3b の試作: 束ねた print-craft MCP（dist/）を .mcpb にする（0-4 の build-mcpb.mjs を元にした。無圧縮の zip を自分で書く）。
// 0-4 と同じ名前（print-craft-authoring-proto）で版を上げるので、Desktop では 0-4 の試作を置き換える。
// 設定項目は作業フォルダーと印刷屋の zip だけ（保存は kintone に接続しないので、URL と API トークンは使わない）。
// 使い方: node build.mjs && node build-mcpb.mjs  → dist-mcpb/print-craft-proto.mcpb
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const dist = join(here, "dist");
const outDir = join(here, "dist-mcpb");
const outPath = join(outDir, "print-craft-proto.mcpb");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

export const manifest = {
  manifest_version: "0.3",
  name: "print-craft-authoring-proto",
  display_name: "印刷屋 設定オーサリング（Print craft 試作）",
  version: pkg.version,
  description: "段階 0-3b の試作。印刷屋プラグインの新しい設定 JSON を、検査（normalize）を通して作業フォルダーに保存する（帳票の作り方の資料はまだ無い）",
  author: { name: "rex0220" },
  license: "MIT",
  server: {
    type: "node",
    entry_point: "server/index.cjs",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.cjs", "--surface", "desktop", "--workspace-dir", "${user_config.workspaceDir}"],
      // 印刷屋の zip は環境変数で渡す（中核は OS の環境変数の PCRAFT_PLUGIN_ZIP を絶対パスだけ受け付ける）
      env: { PCRAFT_PLUGIN_ZIP: "${user_config.pluginZip}" }
    }
  },
  tools: [
    { name: "pcraft_status", description: "kintone の印刷屋プラグイン（rex0220 Print craft）の帳票の設定づくりの環境の診断（作業フォルダー、印刷屋の zip。準備ができているか）" },
    { name: "pcraft_save_settings", description: "印刷屋プラグイン（Print craft）の新しい設定 JSON を、検査（normalize）を通して作業フォルダーに保存する（上書きしない）" }
  ],
  tools_generated: false,
  keywords: ["kintone", "print-craft", "mcp"],
  compatibility: {
    claude_desktop: ">=0.10.0",
    platforms: ["darwin", "win32"],
    runtimes: { node: ">=20.0.0" }
  },
  user_config: {
    workspaceDir: {
      type: "directory",
      title: "作業フォルダー",
      description: "印刷屋の設定を置くフォルダー（試作用のフォルダーを選ぶ。無ければ最後の 1 段だけ作る）",
      required: true
    },
    pluginZip: {
      type: "file",
      title: "印刷屋プラグインの zip",
      description: "アプリに入れた印刷屋プラグインの zip（配布元から入手したもの。同じ版）",
      required: true
    }
  }
};

const readme = `# 印刷屋 設定オーサリング（試作 0-3b ${pkg.version}）

段階 0-3b の試作。ツールは pcraft_status（診断）と pcraft_save_settings（新しい設定の保存）だけ。秘密の値は使わない。
同梱の依存（MCP の SDK、zod、happy-dom など）の著作権表示は server/print-craft-mcp.cjs の末尾にある。
`;

const files = [
  { path: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") },
  { path: "server/index.cjs", data: readFileSync(join(dist, "server", "index.cjs")) },
  { path: "server/print-craft-mcp.cjs", data: readFileSync(join(dist, "server", "print-craft-mcp.cjs")) },
  { path: "vendor/moment-with-locales.min.js", data: readFileSync(join(dist, "vendor", "moment-with-locales.min.js")) },
  { path: "vendor/moment.json", data: readFileSync(join(dist, "vendor", "moment.json")) },
  { path: "README.md", data: Buffer.from(readme, "utf8") }
];

function isIgnored() {
  const p = join(repoRoot, ".gitignore");
  return existsSync(p) && readFileSync(p, "utf8").split(/\r?\n/).some((l) => ["dist-mcpb/", "*.mcpb"].includes(l.trim()));
}

// ---- 無圧縮の zip（0-4 と同じ） ----
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ b) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path.replace(/\\/g, "/"), "utf8");
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 の名前
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}

// ---- 実行（CRC32_TABLE の初期化の後） ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!isIgnored()) throw new Error(".gitignore に dist-mcpb/ と *.mcpb が無い（成果物をコミットしない）");
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const zip = createZip(files);
  writeFileSync(outPath, zip);
  console.log(`[build-mcpb] ${outPath} (${zip.length.toLocaleString()} bytes; 版 ${pkg.version})`);
}
