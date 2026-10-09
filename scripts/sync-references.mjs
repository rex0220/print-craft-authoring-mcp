// テンプレート（print-craft-authoring）の docs/ を references/template/ に写す（実装案 3.2、5.5、8.2、12.4）。
//   - 写すのは帳票の資料・関数の資料・設定ファイル仕様・既定の CSS・雛形だけ（利用者向けの手順書は写さない）
//   - 写した元のコミットと、各ファイルの sha256・大きさを references/template/SOURCE.json に書く（build-mcp.mjs が照合する。手で二重に直さない）
//   - 元の資料にコミットしていない変更があれば止める（--allow-dirty で写せるが、SOURCE.json に dirty と書く）
// 使い方: node scripts/sync-references.mjs [テンプレートのフォルダー（既定 ../print-craft-authoring）] [--allow-dirty]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const allowDirty = args.includes("--allow-dirty");
const template = path.resolve(root, args.find((a) => !a.startsWith("--")) ?? "../print-craft-authoring");
const outDir = path.join(root, "references", "template");

export const FILES = [
  "docs/帳票レシピ集.md",
  "docs/帳票関数リファレンス.md",
  "docs/設定ファイル仕様.md",
  "docs/フィールドタイプ別仕様.md",
  "docs/関数一覧.md",
  "docs/関数リファレンス（詳細）.md",
  "docs/関数の使い方（計算式プラグインの記事）.md",
  "docs/defaults/cssInfo.json",
  "docs/samples/見積書/settings-source.json",
  "docs/samples/一覧帳票/settings-source.json"
];

const git = (...a) => execFileSync("git", ["-C", template, ...a], { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const dirtyFiles = git("status", "--porcelain", "--", ...FILES);
if (dirtyFiles && !allowDirty) {
  console.error(`元の資料にコミットしていない変更がある（コミットしてから写す。--allow-dirty で写せる）:\n${dirtyFiles}`);
  process.exit(1);
}
rmSync(outDir, { recursive: true, force: true });
const files = [];
for (const f of FILES) {
  const src = path.join(template, f);
  const dst = path.join(outDir, f);
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  const data = readFileSync(dst);
  files.push({ path: f, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
}
const source = { repository: "rex0220/print-craft-authoring", commit, short: commit.slice(0, 7), dirty: Boolean(dirtyFiles), copiedAt: new Date().toISOString(), files };
writeFileSync(path.join(outDir, "SOURCE.json"), `${JSON.stringify(source, null, 2)}\n`);
console.log(`[sync-references] ${files.length} ファイルを ${path.relative(root, outDir)} に写した（元 ${source.repository} ${source.short}${source.dirty ? "、未コミットの変更あり" : ""}。${files.reduce((n, f) => n + f.bytes, 0).toLocaleString()} バイト）`);
