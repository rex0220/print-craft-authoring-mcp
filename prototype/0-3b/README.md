# 段階 0-3b の試作（中核を呼ぶ print-craft MCP の保存のツール）

実装案（[../../docs/プラグイン化の実装案.md](../../docs/プラグイン化の実装案.md)）の 9 章 0-3b。中核を呼ぶ print-craft MCP のツール `pcraft_save_settings` を、Claude Code（プラグインの `.mcp.json`）と Desktop（`.mcpb`）の両方から試す。確かめるのは、`ok` / `conflict` / `denied` / `invalid` / `failed` が 5.2 の約束どおりになるか。秘密の値は使わない。kintone には接続しない。

## ファイル

| ファイル | 中身 |
| --- | --- |
| `src/server.ts` | print-craft MCP（MCP の SDK v2 の `McpServer` と `serveStdio`）。ツールは `pcraft_status`（診断）と `pcraft_save_settings`（新しい設定の保存）。応答は 5.2 の形 |
| `src/binding.ts` | 作業フォルダーの結び付け（4.1）。Desktop は `--workspace-dir` を起動時に固定（無ければ最後の 1 段を作る）、Claude Code は `--roots`（登録済みの作業フォルダー）と照合 |
| `src/core.ts` | 共通の中核（隣の `print-craft-authoring/tools/src`）への参照。ここだけ（配り方は B1 の前に決める） |
| `build.mjs` | esbuild で 1 つの CJS ファイルに束ねる（中核、SDK、zod、happy-dom）。`dist/server/index.cjs`（起動のファイル）、`dist/server/print-craft-mcp.cjs`、`dist/vendor/`（moment） |
| `build-mcpb.mjs` / `verify-mcpb.mjs` | `.mcpb` を作る（0-4 と同じ名前で版を上げる）/ 展開して Desktop と同じ形で起動して確かめる |
| `test/server.test.mjs` | 束ねたサーバーを MCP のクライアント（SDK v2）で起動して試す |
| `.claude-plugin/plugin.json`、`.mcp.json`、`hooks/` | Claude Code のプラグイン `print-craft-proto`（0-3a と同じ名前。登録済みの作業フォルダーがそのまま使える）。フックは 0-3a のまま |
| `scripts/make-sample.mjs` | 手での確認の準備（作業フォルダーに試験用の項目定義と設定の見本を置く） |

作り方（`prototype/0-3b` で。隣に `print-craft-authoring`（tools の `npm ci` 済み）と `print-craft`（`dist/print-craft-plugin7.zip`）が要る）:

```sh
npm ci
npm test                 # ビルド → MCP の試験
npm run build:mcpb       # dist-mcpb/print-craft-proto.mcpb
node verify-mcpb.mjs
```

## 決めたこと

- **MCP の SDK は 2.0.0 に固定**（`@modelcontextprotocol/server` / `client`、zod 4.4.3）。kSQL が Desktop で「modern」と判定されたのと同じ組み合わせ。最新の 2.3.1 は公開から 4 日（2026-10-05）なので使わない。B1 で見直す
- **束ね方**: CJS の 1 ファイル（実装案 8.3）。中核の `paths.ts` が `import.meta.url` から自分の場所を求めるので、本体のファイルの URL に置き換える（`define`）。中核のエンジンは「本体の 1 つ上の `vendor/`」の moment を読むので、`vendor/` を並べて置く。中核の版（tools の `package.json` と commit）を埋め込み、`mode: "build"`（隣の print-craft の `prod/` を読まない）
- **標準出力は JSON-RPC だけ**: `console.log` などを標準エラーに回す（中核や印刷屋の zip のコードが書いても応答を壊さない）
- **印刷屋の zip**: 設定項目（環境変数 `PCRAFT_PLUGIN_ZIP`。絶対パスだけ）か、作業フォルダーの `.env`（今の CLI と同じ）。無い・読めないときは `failed`（`PluginZipError`）と、設定のしかた
- **エンジンは 1 プロセスに 1 つ**なので、保存は 1 つずつ順に動かす
- **作ったこと（作業フォルダー）は標準エラーにだけ出す**（Desktop は何度も起動し直すので、応答にプロセスごとの印を出さない。4.1）

## 0-3b で見つけて直したこと（中核）

- **保存先のフォルダーが無いと保存できなかった**（`settings/` がまだ無い作業フォルダー。Desktop で作ったばかりの作業フォルダーがこれ）。しかもその失敗（ENOENT）を `denied` で返していた
- → `print-craft-authoring` のブランチ `core-0-3b`（`tools/src/commands/save.ts`）: 書ける場所と許可を確かめた後に、書く先のフォルダーを作る。誤りの分け方を約束に合わせた（競合は `conflict`、書けない場所・本番・ダウンロードのファイル・作業フォルダーの外は `denied`、項目定義のファイルが無い・`fields` が無いは `invalid`、読み書きの失敗など想定外は `failed`）。結果に `code`（誤りの種類）。tools の試験 175 件
- 今の CLI は `save.ts` の保存を使っていない（`buttons --json` の digest だけ）ので、公開済みの tools 1.2.0 の CLI の利用者には影響しない

## 自動で確かめたこと（2026-10-09、Mac、Node 24.14.0）

- `npm test`: 7 件すべて通った
  - ツールは 2 つ、入力は厳しいスキーマ（`additionalProperties: false`、Claude Code では `workspaceId` が必須）、指示の 1 行目に版
  - `ok`（digest は確定したファイル、normalize の派生値）、同じ名前は `conflict`、normalize のエラーは `invalid`（保存しない）
  - `denied`: 作業フォルダーの外、登録していない `workspaceId`（`WorkspaceError`。フックが再接続の案内に置き換える文）、本番のフォルダー、ダウンロードの名前
  - 入力の誤り（`workspaceId` が無い、`expectedAbsent: false`、知らない引数）は誤りの結果（保存しない）
  - `failed`: 印刷屋の zip が未設定・相対パス・zip でない
  - Desktop: 無い作業フォルダーの最後の 1 段を作る（`"` で囲んだパスも）、`workspaceId` は省略できる、違えば `denied`、すぐ上が無ければ作らずに `denied`
  - 環境変数の API トークン（試験用の値）が応答・標準エラーに出ない
- `verify-mcpb.mjs`: 通った（中身の一覧、manifest、展開して Desktop と同じ形で起動、作業フォルダーを作る、保存の ok / conflict / denied）
- `claude plugin validate`: 通った。`claude plugin test`: フックの 15 件すべて通った

## 手で確かめること（Takashi）

準備（試験用の作業フォルダーに、項目定義と設定の見本を置く。テンプレートのフォルダーでは試さない）:

```sh
cd ~/Projects/kintone-plugin/print-craft-authoring-mcp/prototype/0-3b
npm ci && npm run build:mcpb
node scripts/make-sample.mjs ~/pcraft-proto-ws --production
mkdir -p ~/pcraft-proto-desktop && node scripts/make-sample.mjs ~/pcraft-proto-desktop
```

印刷屋の zip は `~/Projects/kintone-plugin/print-craft/dist/print-craft-plugin7.zip` を使う（`.env` は使わない）。

### Claude Code（プラグイン）

```sh
CLAUDE=~/.vscode/extensions/anthropic.claude-code-2.1.292-darwin-arm64/resources/native-binary/claude
cd ~/pcraft-proto-ws
"$CLAUDE" --plugin-dir ~/Projects/kintone-plugin/print-craft-authoring-mcp/prototype/0-3b
```

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | `/config` で print-craft-proto の「印刷屋プラグインの zip」に zip の絶対パスを入れ、`/mcp` で print-craft を再接続 | `/mcp` に print-craft とツール 2 つ | |
| 2 | 「印刷屋の pcraft_status を呼んで」 | `ready: true`。`registered` に `~/pcraft-proto-ws` の実際のパス（0-3a で登録済み）、`pluginZip.source` が「設定項目」 | |
| 3 | 「temp/sample-見積書.json の中身を、fields/3740.json の項目定義で settings/APP3740-見積書-見積書.json に印刷屋で保存して」 | `ok`。警告（`formula.rawHtml` など）を AI が利用者に伝える。`settings/` にファイルができる。未登録なら登録の確認 → 再接続 → もう一度 | |
| 4 | 同じ依頼をもう一度 | `conflict`（上書きしない） | |
| 5 | 「temp/sample-壊れた.json の中身を settings/壊れた.json に印刷屋で保存して」 | `invalid`（`envelope.pluginID` のエラー）。ファイルはできない | |
| 6 | 「temp/sample-見積書.json の中身を kintone/x.cybozu.com/3740-見積書/新しい帳票.json に印刷屋で保存して」 | `denied`（本番。role: production） | |
| 7 | 「settings/直接.json に Write で直接書いて」 | フックが拒否（print-craft MCP の保存のツールを使う） | |
| 8 | （任意）`/config` で zip を空にして `/mcp` で再接続 → 3 と同じ依頼（名前を変えて） | `failed`（zip が未設定。設定のしかた）。作業フォルダーの `.env` が無いこと | |

### Desktop（`.mcpb`）

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | `dist-mcpb/print-craft-proto.mcpb` をダブルクリック（または Settings > Extensions）で入れる | 0-4 の試作が 0.0.6 に置き換わる。設定項目は「作業フォルダー」と「印刷屋プラグインの zip」だけ | |
| 2 | 作業フォルダーに `~/pcraft-proto-desktop`、zip に `print-craft-plugin7.zip` を選び、新しいチャット | | |
| 3 | 「印刷屋の pcraft_status を呼んで」 | `ready: true`、`workspace.path` が作業フォルダー | |
| 4 | `temp/sample-見積書.json` の中身を貼って「印刷屋で、次の設定を settings/APP3740-見積書-見積書.json に保存して（項目定義は fields/3740.json）」 | `ok`。警告を AI が伝える。`~/pcraft-proto-desktop/settings/` にファイルができる（`settings/` は無くても作る） | |
| 5 | 同じ依頼をもう一度 | `conflict` | |
| 6 | 「同じ内容を ../outside.json に印刷屋で保存して」 | `denied`（作業フォルダーの外） | |
| 7 | Desktop の `main.log`（`~/Library/Logs/Claude/`） | `[print-craft-mcp] print-craft MCP（試作 0-3b 0.0.6 …）node=v24.… surface=desktop` の行。秘密の値が無い | |
