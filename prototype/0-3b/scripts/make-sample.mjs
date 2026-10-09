// 段階 0-3b の手での確認の準備: 作業フォルダーに、試験用の項目定義と設定の見本を置く（tools の試験の雛形。アプリ 3740 の形のダミー）。
//   fields/3740.json                  項目定義（pcraft_save_settings の fields に渡す）
//   temp/sample-見積書.json            正しい設定（保存すると ok。警告はある）
//   temp/sample-壊れた.json            pluginID が違う設定（保存すると invalid）
//   --production を付けると、本番の環境（role: production）とそのアプリのフォルダーも置く（保存すると denied）:
//     environments.json、kintone/x.cybozu.com/3740-見積書/fields.json
// 既にあるファイルは上書きしない。使い方: node scripts/make-sample.mjs <作業フォルダー> [--production]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(here, "../../../../print-craft-authoring/tools");
const [dirArg, ...rest] = process.argv.slice(2);
if (!dirArg) {
  console.error("使い方: node scripts/make-sample.mjs <作業フォルダー> [--production]");
  process.exit(2);
}
const root = path.resolve(dirArg);
if (!existsSync(root)) {
  console.error(`作業フォルダーが無い: ${root}`);
  process.exit(1);
}
const { FIELDS_FILE, aiSettings } = await import(pathToFileURL(path.join(TOOLS, "test", "fixtures.mjs")).href);

const files = {
  "fields/3740.json": JSON.stringify(FIELDS_FILE, null, 2),
  "temp/sample-見積書.json": JSON.stringify(aiSettings(), null, 2),
  "temp/sample-壊れた.json": JSON.stringify(aiSettings({ pluginID: "other" }), null, 2)
};
if (rest.includes("--production")) {
  files["environments.json"] = JSON.stringify({ environments: { prod: { baseUrl: "https://x.cybozu.com", role: "production" } } }, null, 2);
  files["kintone/x.cybozu.com/3740-見積書/fields.json"] = JSON.stringify(FIELDS_FILE, null, 2);
}
for (const [rel, text] of Object.entries(files)) {
  const file = path.join(root, rel);
  if (existsSync(file)) {
    console.log(`既にある（そのまま）: ${rel}`);
    continue;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${text}\n`, { flag: "wx" });
  console.log(`置いた: ${rel}`);
}
