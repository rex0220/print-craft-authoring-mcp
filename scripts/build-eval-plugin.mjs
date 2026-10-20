// 自動の確かめ（claude plugin eval）に使う、eval 専用のプラグインの写しを .tmp/eval-plugin/ に作る（コミットしない）。
// 中身は公開のプラグイン（build-plugin-zip.mjs の pluginEntries）と同じで、eval の実行の一時フォルダーを作業フォルダーにするための 2 つだけを替える
// （eval の実行は一時の設定で動き、プラグインの設定項目（作業フォルダー・zip）が空。作業フォルダーの登録の確認の画面にも答えられない）:
//   - .mcp.json: 起動のファイル eval-launch.cjs（サーバーの作業フォルダー = 実行の一時フォルダーを --roots に渡す）。印刷屋の zip は決まったパス
//   - hooks/register.ts: 登録済みの作業フォルダーの代わりにセッションのフォルダーを使う（workspaceId の書き換えと、直接の書き込みの拒否はそのまま）
// evals/ も写す（claude plugin eval は対象のプラグインの evals/ を読む。results/ は除く）。
// 使い方: node build-mcp.mjs && node scripts/build-eval-plugin.mjs → claude plugin eval .tmp/eval-plugin --mocks off --allow-tools "mcp__plugin_print-craft_print-craft__*" …（evals/README.md）
// 印刷屋の zip: PCRAFT_EVAL_PLUGIN_ZIP（既定 ../print-craft/dist/print-craft-plugin9.zip）
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginEntries } from "./build-plugin-zip.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(root, ".tmp", "eval-plugin");
const zip = path.resolve(process.env.PCRAFT_EVAL_PLUGIN_ZIP ?? path.join(root, "..", "print-craft", "dist", "print-craft-plugin9.zip"));
if (!existsSync(zip)) throw new Error(`印刷屋の zip が無い: ${zip}（PCRAFT_EVAL_PLUGIN_ZIP で指定できる）`);

rmSync(out, { recursive: true, force: true });
for (const e of pluginEntries()) {
  const dst = path.join(out, e.path);
  mkdirSync(path.dirname(dst), { recursive: true });
  writeFileSync(dst, e.data);
}

// サーバー: 作業フォルダーはこのプロセスの作業フォルダー（Claude Code がセッションのフォルダーで起動する）
writeFileSync(
  path.join(out, "eval-launch.cjs"),
  `// eval 専用（scripts/build-eval-plugin.mjs が作る）: 作業フォルダーを、このプロセスの作業フォルダー（eval の実行の一時フォルダー）にして起動する
const path = require("node:path");
process.argv.splice(2, 0, "--surface", "claude-code", "--roots", JSON.stringify([process.cwd()]));
require(path.join(__dirname, "dist", "server", "index.cjs"));
`
);
writeFileSync(
  path.join(out, ".mcp.json"),
  `${JSON.stringify({ mcpServers: { "print-craft": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/eval-launch.cjs"], env: { PCRAFT_PLUGIN_ZIP: zip } } } }, null, 2)}\n`
);

// フック: 登録済みの作業フォルダー（設定項目）の代わりにセッションのフォルダー
const hookFile = path.join(out, "hooks", "register.ts");
const hook = readFileSync(hookFile, "utf8");
const from = "row?.value ?? options.workspaceRoots";
const count = hook.split(from).length - 1;
if (count !== 2) throw new Error(`フックの登録済みの作業フォルダーを読む所が 2 つでない（${count}）。build-eval-plugin.mjs を直す`);
writeFileSync(hookFile, `// eval 専用の写し（scripts/build-eval-plugin.mjs）: 登録済みの作業フォルダーの代わりにセッションのフォルダーを使う\n${hook.split(from).join("JSON.stringify([await $.session.root()])")}`);

// 確かめのケース
cpSync(path.join(root, "evals"), path.join(out, "evals"), { recursive: true, filter: (src) => !src.split(path.sep).includes("results") });
// ケースの scaffold が作業フォルダーに置く試験用の fixture（test/fixtures の架空の値）
mkdirSync(path.join(out, "evals", "_fixtures"), { recursive: true });
for (const f of ["settings-mitsumori.json", "fields-3740.json", "record-3740-3.json"]) cpSync(path.join(root, "test", "fixtures", f), path.join(out, "evals", "_fixtures", f));
console.log(`[build-eval-plugin] ${path.relative(root, out)}（印刷屋の zip ${zip}）`);
