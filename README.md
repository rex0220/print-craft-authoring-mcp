# print-craft-authoring-mcp（開発中・未公開）

kintone の印刷屋プラグイン（rex0220 Print craft）の帳票の設定 JSON を、検査（normalize）を通して作業フォルダーに保存・確認する **print-craft MCP**（Claude Code のプラグインと Claude Desktop の `.mcpb`）。中核は npm の [`@rex0220/print-craft-authoring-tools/core`](https://www.npmjs.com/package/@rex0220/print-craft-authoring-tools)。設計は [docs/プラグイン化の実装案.md](docs/プラグイン化の実装案.md)。

今は段階 B1（print-craft MCP の本体）。プラグインのスキルとフックの仕上げは B2、`.mcpb` のリリースは B3。

## 構成

| 場所 | 中身 |
| --- | --- |
| `src/` | print-craft MCP（MCP の SDK v2）。`server.ts`（ツールの登録）、`binding.ts`（作業フォルダーの結び付け 4.1）、`compat.ts`（互換表 7 章）、`docs.ts`（資料 5.5）、`tools/`（ツール） |
| `guide/` | `pcraft_docs` の手順の章（print-craft MCP のツールで書いた） |
| `references/template/` | テンプレートの `docs/` の写し（`scripts/sync-references.mjs`。元のコミットと sha256 は `SOURCE.json`） |
| `compat.json` | 互換表 |
| `build-mcp.mjs` | 1 つの CJS ファイルに束ねる → `dist/` |
| `build-mcpb.mjs` / `scripts/mcpb-verify.mjs` | `.mcpb` を作る → `dist-mcpb/print-craft.mcpb` / 検査 |
| `.claude-plugin/plugin.json`、`.mcp.json`、`hooks/` | Claude Code のプラグイン `print-craft` |
| `test/` | 試験（束ねた本体を MCP のクライアントで起動する。kintone は `test/mock-fetch.mjs` の偽物） |
| `prototype/` | 段階 0 の試作（0-3a、0-3b、0-4） |

ツール: `pcraft_docs`、`pcraft_status`、`pcraft_workspace_status`、`pcraft_save_settings`、`pcraft_update_button`、`pcraft_buttons`、`pcraft_normalize`、`pcraft_preview`、`pcraft_fields`、`pcraft_record`、`pcraft_pull`、`pcraft_files`、`pcraft_take`、`pcraft_edit`、`pcraft_diff`（Claude Code と Desktop）、`kintone_get_app`、`kintone_list_records`（Desktop だけ。Claude Code では公式の kintone MCP）。

## 作り方と試験

隣に `print-craft`（印刷屋の zip `dist/print-craft-plugin7.zip`。試験だけ）があること。

中核は npm の `@rex0220/print-craft-authoring-tools` 1.3.1（lockfile で固定。`compat.json` の `coreVersion` は 1.3.1 以上）。公開前の中核で試すときは、隣の print-craft-authoring の `tools` で `npm pack` した tarball を `npm install --no-save <tgz>` で入れる（`package.json` と lockfile は変えない）。

```sh
npm ci
npm test                 # ビルド → 試験
npm run verify:mcpb      # ビルド → .mcpb → 検査
CLAUDE=~/.vscode/extensions/anthropic.claude-code-2.1.292-darwin-arm64/resources/native-binary/claude
"$CLAUDE" plugin validate . && "$CLAUDE" plugin test .
node scripts/sync-references.mjs   # テンプレートの資料を写し直す（compat.json の docsRevision も合わせる）
```

## 手で確かめること（B1）

試作（`print-craft-proto`）は外しておく（同じ表示名・ツール名で紛らわしい）。試験用の作業フォルダーで試す（テンプレートのフォルダーでは試さない）。

### Claude Code（`--plugin-dir`）

```sh
npm ci && npm run build
mkdir -p ~/pcraft-b1-ws && cd ~/pcraft-b1-ws
"$CLAUDE" --plugin-dir ~/Projects/kintone-plugin/print-craft-authoring-mcp
```

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | `/config` で print-craft の「印刷屋プラグインの zip」（絶対パス）と、kintone の URL・API トークン（閲覧だけ。試験用のアプリ）を入れ、`/mcp` で再接続 | `/mcp` に print-craft とツール 15 | |
| 2 | 「印刷屋で見積書の帳票を作りたい」 | `pcraft_docs` が呼ばれ、目次に版と作業の順 | |
| 3 | （続き）アプリの番号を伝える | `pcraft_status` → 作業フォルダーの登録の確認 → 再接続 → `pcraft_fields` で項目の要約 | |
| 4 | （続き）代表のレコードを決める | `pcraft_record` で形だけ（値は出ない） | |
| 5 | （続き）帳票を書いて保存 | `pcraft_save_settings` が `ok`、警告を伝える | |
| 6 | （続き）preview | `pcraft_preview` が `out/` に書く。Chrome で開く | |
| 7 | 「settings/x.json に Write で直接書いて」 | フックが拒否 | |
| 8 | 「同じ名前でもう一度保存して」 | `conflict`（ツールを呼んで返った結果を伝える） | |

### Desktop（`.mcpb`）

`npm run build:mcpb` → `dist-mcpb/print-craft.mcpb` を入れる → **Desktop を終了して起動し直す** → 新しいチャット。

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | 設定項目: 作業フォルダー（選ぶ画面で）、zip、kintone の URL・API トークン（閲覧だけ。試験用のアプリ） | 設定画面でトークンが平文で見えない | |
| 2 | 「印刷屋で見積書の帳票を作りたい」 | `pcraft_docs` → `pcraft_status`（版 0.1.0、`ready: true`） | |
| 3 | アプリの番号か URL を伝える | `kintone_get_app` で名前、`pcraft_fields` で要約 | |
| 4 | 代表のレコードを選ぶ | `kintone_list_records`（形だけ、5 件）→ `pcraft_record` | |
| 5 | 帳票を書いて保存 → preview | `pcraft_save_settings` `ok` → `pcraft_preview` | |
| 6 | 同じ名前でもう一度保存 | `conflict`（ツールを呼んで返った結果を伝える。推し量らない） | |
| 7 | `main.log` | `[print-craft-mcp] print-craft MCP 0.1.0 …` の行。秘密の値、レコードの値（宛名など）、印刷屋のログ（`file name err`）、moment の警告（`Deprecation warning`）が無い（捨てたときは「console の出力を N 件捨てた」の行だけ） | |
