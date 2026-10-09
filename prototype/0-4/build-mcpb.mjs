// 段階 0-4 の試作: hello の print-craft MCP を .mcpb にする（依存なし）。
// kintone-sql-tools の build-mcpb.mjs（同じ作者）を元にした: 無圧縮（STORED）の zip を自分で書く、起動のファイルは main() を必ず呼ぶ
// （Desktop 同梱の Node では require.main === module の判定が効かず、初期化が時間切れになった。kSQL）。
// 使い方: node prototype/0-4/build-mcpb.mjs  → prototype/0-4/dist-mcpb/print-craft-proto.mcpb
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const outDir = join(here, "dist-mcpb");
const outPath = join(outDir, "print-craft-proto.mcpb");
const serverPath = join(here, "server", "hello.cjs");
const { VERSION } = createRequire(import.meta.url)(serverPath);
// .mcpb の版は semver。試作の印（-proto）は除いて 0.0.1 とする
const version = VERSION.replace(/-.*$/, "");

export const manifest = {
  manifest_version: "0.3",
  name: "print-craft-authoring-proto",
  display_name: "印刷屋 設定オーサリング（試作 0-4）",
  version,
  description: "段階 0-4 の試作。Claude Desktop での設定項目・秘密の値・資料のツールの動きを確かめる（帳票は作らない）",
  author: { name: "rex0220" },
  license: "MIT",
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: [
        "${__dirname}/server/index.js",
        "--surface", "desktop",
        "--workspace-dir", "${user_config.workspaceDir}",
        "--plugin-zip", "${user_config.pluginZip}",
        "--base-url", "${user_config.kintoneBaseUrl}"
      ],
      // 秘密の値は引数でなく環境変数で渡す（MCPB Manifest Spec の推奨。実装案 6.2）
      env: { KINTONE_API_TOKEN: "${user_config.kintoneApiToken}" }
    }
  },
  tools: [
    { name: "pcraft_docs", description: "印刷屋の手順と資料（読み取りだけ。resources の代わり）" },
    { name: "pcraft_status", description: "診断（版、Node、設定項目の届き方。秘密の値は出さない）" },
    { name: "pcraft_workspace_status", description: "作業フォルダーの診断" },
    { name: "kintone_probe", description: "（任意）API トークンで app とプラグインの設定情報の API が通るか（状態だけ）" }
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
      description: "印刷屋の設定を置くフォルダー（試作用の空のフォルダーを選ぶ）",
      required: true
    },
    kintoneBaseUrl: {
      type: "string",
      title: "kintone の URL（任意。試験用の環境）",
      description: "https://<サブドメイン>.cybozu.com。本番の環境は入れない",
      required: false
    },
    kintoneApiToken: {
      type: "string",
      title: "API トークン（任意。試験用・閲覧だけ）",
      description: "本番でない環境の、閲覧だけの API トークンか、ダミーの文字列",
      sensitive: true,
      required: false
    },
    pluginZip: {
      type: "file",
      title: "印刷屋プラグインの zip（任意）",
      description: "試作では読まない。選ぶ画面が返すパスの形を見るだけ",
      required: false
    }
  }
};

const launcher = `#!/usr/bin/env node
// main() を必ず呼ぶ（直接起動されたかの判定で分けない。kSQL）
const { main } = require("./hello.cjs");
main().catch((err) => {
  process.stderr.write(\`\${err instanceof Error ? err.name : "Error"}\\n\`);
  process.exitCode = 1;
});
`;

const readme = `# 印刷屋 設定オーサリング（試作 0-4）

段階 0-4 の試作。帳票は作らない。秘密の値は応答・ログに出さない。
`;

const files = [
  { path: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") },
  { path: "server/index.js", data: Buffer.from(launcher, "utf8") },
  { path: "server/hello.cjs", data: readFileSync(serverPath) },
  { path: "README.md", data: Buffer.from(readme, "utf8") }
];

function isIgnored() {
  const p = join(repoRoot, ".gitignore");
  return existsSync(p) && readFileSync(p, "utf8").split(/\r?\n/).some(l => ["dist-mcpb/", "*.mcpb"].includes(l.trim()));
}

// ---- 無圧縮の zip（kSQL の build-mcpb.mjs と同じ） ----
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
  writeFileSync(outPath, createZip(files));
  console.log(`[build-mcpb] ${outPath}`);
}
