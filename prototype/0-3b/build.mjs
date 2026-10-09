// 段階 0-3b の試作: print-craft MCP を esbuild で 1 つの CJS ファイルにする（実装案 8.3）。
//   - 中核（隣の print-craft-authoring の tools/src）、MCP の SDK v2、zod、happy-dom を束ねる。印刷屋 / kit / rexgrid のコードは入れない（型だけ）
//   - 出力: dist/server/print-craft-mcp.cjs（本体）、dist/server/index.cjs（起動のファイル。main() を必ず呼ぶ。kSQL）、
//     dist/vendor/moment-with-locales.min.js（中核のエンジンが読む。tools の paths.ts は「本体の 1 つ上の vendor/」を見る）
//   - 中核の版（tools の package.json と commit）と、このサーバーの版を埋め込む。中核は mode "build"（隣の print-craft の prod/ を読まない）
//   - CJS に import.meta.url は無いので、本体のファイルの URL に置き換える（tools の paths.ts が自分の場所から vendor/ を探す）
// 使い方: node build.mjs（prototype/0-3b で）
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsRoot = path.resolve(here, "../../../print-craft-authoring/tools");
const dist = path.join(here, "dist");
const pkg = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"));

const { devMeta } = await import(pathToFileURL(path.join(toolsRoot, "src", "meta.ts")).href);
const { kitRoot, rexgridRoot, PRINT_CRAFT_ROOT } = await import(pathToFileURL(path.join(toolsRoot, "src", "dev-paths.ts")).href);
const toolsMeta = { ...devMeta(), builtAt: new Date().toISOString(), mode: "build" };

rmSync(dist, { recursive: true, force: true });
const result = await build({
  entryPoints: [path.join(here, "src", "server.ts")],
  outfile: path.join(dist, "server", "print-craft-mcp.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  charset: "utf8",
  // 束ねた依存（MCP の SDK、zod、happy-dom など）の著作権表示はファイルの末尾に残す
  legalComments: "eof",
  // ws（happy-dom の依存）の任意の高速化の部品。無ければ ws が自分で代わりを使う
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    js: `/*! print-craft MCP 試作 0-3b ${pkg.version}（中核 @rex0220/print-craft-authoring-tools ${toolsMeta.toolsVersion}、commit ${toolsMeta.commit}）。MIT License. 計算式エンジンと印刷屋のコードは利用者の印刷屋プラグインの zip から読む（このファイルには含まれない） */\nvar __pcraft_import_meta_url = require("node:url").pathToFileURL(__filename).href;`
  },
  define: {
    __PCRAFT_TOOLS_META__: JSON.stringify(JSON.stringify(toolsMeta)),
    __PCRAFT_MCP_VERSION__: JSON.stringify(pkg.version),
    "import.meta.url": "__pcraft_import_meta_url"
  },
  alias: { "print-craft": PRINT_CRAFT_ROOT, "plugin-config-kit": kitRoot(), rexgrid: rexgridRoot() },
  absWorkingDir: here,
  // ルートの tsconfig.json はフック用（Claude Code が読み込んだときに型の設定を置く）。サーバーはこちら
  tsconfig: path.join(here, "tsconfig.server.json"),
  metafile: true,
  logLevel: "warning"
});

const inputs = Object.keys(result.metafile.inputs);
const leaked = inputs.filter((p) => /print-craft[\\/](src|lib|prod)[\\/]|plugin-config-kit[\\/]src|rexgrid[\\/]src/.test(p));
if (leaked.length) throw new Error(`印刷屋 / kit / rexgrid のコードが束ねられている（型だけの import にする）:\n  ${leaked.join("\n  ")}`);
const bundle = readFileSync(path.join(dist, "server", "print-craft-mcp.cjs"), "utf8");
for (const re of [/require\(["']@modelcontextprotocol\//, /require\(["']zod(?:\/[^"']*)?["']\)/, /require\(["']happy-dom/]) {
  if (re.test(bundle)) throw new Error(`束ねていない依存が残っている: ${re}`);
}

writeFileSync(
  path.join(dist, "server", "index.cjs"),
  `#!/usr/bin/env node
// 起動のファイル: main() を必ず呼ぶ（直接起動されたかの判定で分けない。Desktop 同梱の Node では効かなかった。kSQL）
const { main } = require("./print-craft-mcp.cjs");
main().catch((err) => {
  process.stderr.write(\`[print-craft-mcp] \${err && err.name ? err.name : "Error"}: \${err && err.message ? err.message : ""}\\n\`);
  process.exitCode = 1;
});
`
);
mkdirSync(path.join(dist, "vendor"), { recursive: true });
for (const f of ["moment-with-locales.min.js", "moment.json"]) copyFileSync(path.join(toolsRoot, "vendor", f), path.join(dist, "vendor", f));

// 束ねたものが読み込めるか（起動はしない。main を持つか）
const probe = spawnSync(process.execPath, ["-e", `const m = require(${JSON.stringify(path.join(dist, "server", "print-craft-mcp.cjs"))}); if (typeof m.main !== "function") process.exit(2); console.log(m.VERSION)`], { encoding: "utf8" });
if (probe.status !== 0 || probe.stdout.trim() !== pkg.version) throw new Error(`束ねたものが読み込めない（exit ${probe.status}）:\n${probe.stderr}`);

console.log(`[build] dist/server/print-craft-mcp.cjs (${bundle.length.toLocaleString()} bytes; ${inputs.length} inputs; 版 ${pkg.version}; 中核 tools ${toolsMeta.toolsVersion} ${toolsMeta.commit})`);
