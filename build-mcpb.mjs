// 束ねた print-craft MCP（dist/）を Claude Desktop の .mcpb にする（実装案 8.3。試作 0-3b / 0-4 と kSQL の build-mcpb.mjs を元にした。無圧縮の zip を自分で書く）。
//   - manifest は package.json から（名前・版）。ツールの一覧は束ねた本体の tools/list と同じ（scripts/mcpb-verify.mjs が照合する）
//   - 設定項目: 作業フォルダー（directory、必須）、印刷屋の zip（file、必須）、kintone の URL と API トークン（任意。トークンは sensitive で env）
//   - 秘密の値は引数でなく環境変数で渡す（mcp_config.env。試作 0-4 で、Desktop の設定画面で平文にならず、子のプロセスに届くことを確かめた）
// 使い方: node build-mcp.mjs && node build-mcpb.mjs  → dist-mcpb/print-craft.mcpb
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const outDir = join(root, "dist-mcpb");
export const outPath = join(outDir, "print-craft.mcpb");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Desktop の拡張機能の画面に出すツールの一覧（短い説明。AI に渡る説明は本体の tools/list） */
export const MANIFEST_TOOLS = [
  ["pcraft_docs", "印刷屋の帳票づくりの手順と資料（最初に呼ぶ）"],
  ["pcraft_status", "環境の診断（作業フォルダー、印刷屋の zip）"],
  ["pcraft_workspace_status", "作業フォルダーの診断（environments.json と役割）"],
  ["pcraft_save_settings", "新しい設定を検査して保存（上書きしない）"],
  ["pcraft_update_button", "既存の設定のボタン 1 つを差し替え"],
  ["pcraft_buttons", "設定のボタンの一覧と中身"],
  ["pcraft_normalize", "設定の検査（書き換えない）"],
  ["pcraft_preview", "帳票の試し出力（out/）"],
  ["pcraft_fields", "kintone の項目定義を取る"],
  ["pcraft_record", "kintone のレコードを取る（形だけ返す）"],
  ["pcraft_pull", "アプリの今の印刷屋の設定を取る"],
  ["pcraft_files", "作業フォルダーのファイルの一覧"],
  ["pcraft_take", "inbox のダウンロードをアプリのフォルダーへ"],
  ["pcraft_edit", "ダウンロードを -edit.json に写す"],
  ["pcraft_diff", "2 つの設定の差"],
  ["kintone_get_app", "kintone のアプリの情報"],
  ["kintone_list_records", "kintone のレコードの形を数件"]
];

export const manifest = {
  manifest_version: "0.3",
  name: "print-craft-authoring",
  display_name: "印刷屋 設定オーサリング（Print craft）",
  version: pkg.version,
  description: "kintone の印刷屋プラグイン（rex0220 Print craft）の帳票の設定 JSON を、検査（normalize）を通して作業フォルダーに保存・確認する。kintone には読み取り（GET）だけ",
  author: { name: "rex0220" },
  license: "MIT",
  server: {
    type: "node",
    entry_point: "server/index.cjs",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.cjs", "--surface", "desktop", "--workspace-dir", "${user_config.workspaceDir}"],
      env: {
        PCRAFT_PLUGIN_ZIP: "${user_config.pluginZip}",
        KINTONE_BASE_URL: "${user_config.kintoneBaseUrl}",
        KINTONE_API_TOKEN: "${user_config.kintoneApiToken}"
      }
    }
  },
  tools: MANIFEST_TOOLS.map(([name, description]) => ({ name, description })),
  tools_generated: false,
  keywords: ["kintone", "print-craft", "印刷屋", "mcp"],
  compatibility: {
    claude_desktop: ">=0.10.0",
    platforms: ["darwin", "win32"],
    runtimes: { node: ">=20.0.0" }
  },
  user_config: {
    workspaceDir: {
      type: "directory",
      title: "作業フォルダー",
      description: "印刷屋の設定・項目定義・preview を置くフォルダー（無ければ最後の 1 段だけ作る）",
      required: true
    },
    pluginZip: {
      type: "file",
      title: "印刷屋プラグインの zip",
      description: "アプリに入れた印刷屋プラグインの zip（配布元から入手したもの。同じ版）",
      required: true
    },
    kintoneBaseUrl: {
      type: "string",
      title: "kintone の URL",
      description: "https://<サブドメイン>.cybozu.com（項目定義・レコード・設定を取るとき）",
      required: false
    },
    kintoneApiToken: {
      type: "string",
      title: "kintone の API トークン",
      description: "帳票を作るアプリの、閲覧だけの API トークン（チャットには書かない）",
      sensitive: true,
      required: false
    }
  }
};

const readme = `# 印刷屋 設定オーサリング（Print craft）${pkg.version}

kintone の印刷屋プラグイン（rex0220 Print craft）の帳票の設定 JSON を、検査（normalize）を通して作業フォルダーに保存・確認する Claude Desktop の拡張機能。
チャットで「印刷屋で〜」と頼む（最初に pcraft_docs が手順を返す）。kintone には読み取り（GET）だけ。秘密の値は応答・ログに出さない。
同梱の依存（MCP の SDK、zod、happy-dom など）の著作権表示は server/print-craft-mcp.cjs の末尾にある。
`;

function files() {
  return [
    { path: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") },
    { path: "server/index.cjs", data: readFileSync(join(dist, "server", "index.cjs")) },
    { path: "server/print-craft-mcp.cjs", data: readFileSync(join(dist, "server", "print-craft-mcp.cjs")) },
    { path: "vendor/moment-with-locales.min.js", data: readFileSync(join(dist, "vendor", "moment-with-locales.min.js")) },
    { path: "vendor/moment.json", data: readFileSync(join(dist, "vendor", "moment.json")) },
    { path: "LICENSE", data: readFileSync(join(root, "LICENSE")) },
    { path: "README.md", data: Buffer.from(readme, "utf8") }
  ];
}

function isIgnored() {
  const p = join(root, ".gitignore");
  return existsSync(p) && readFileSync(p, "utf8").split(/\r?\n/).some((l) => ["dist-mcpb/", "*.mcpb"].includes(l.trim()));
}

// ---- 無圧縮の zip（試作と kSQL と同じ） ----
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
  const zip = createZip(files());
  writeFileSync(outPath, zip);
  console.log(`[build-mcpb] ${outPath} (${zip.length.toLocaleString()} bytes; 版 ${pkg.version})`);
}
