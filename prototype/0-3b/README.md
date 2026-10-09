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
- **設定項目のパスの先頭の `~/` はホームのフォルダーにする**（0.0.7。設定の欄はシェルを通らないので `~` が展開されず、Desktop で `~/…` を入れて「絶対パスでない」になった。`~user` の形は展開しない）

## 0-3b で見つけて直したこと（中核）

- **保存先のフォルダーが無いと保存できなかった**（`settings/` がまだ無い作業フォルダー。Desktop で作ったばかりの作業フォルダーがこれ）。しかもその失敗（ENOENT）を `denied` で返していた
- → `print-craft-authoring` のブランチ `core-0-3b`（`tools/src/commands/save.ts`）: 書ける場所と許可を確かめた後に、書く先のフォルダーを作る。誤りの分け方を約束に合わせた（競合は `conflict`、書けない場所・本番・ダウンロードのファイル・作業フォルダーの外は `denied`、項目定義のファイルが無い・`fields` が無いは `invalid`、読み書きの失敗など想定外は `failed`）。結果に `code`（誤りの種類）。tools の試験 175 件
- 今の CLI は `save.ts` の保存を使っていない（`buttons --json` の digest だけ）ので、公開済みの tools 1.2.0 の CLI の利用者には影響しない

## 自動で確かめたこと（2026-10-09、Mac、Node 24.14.0）

- `npm test`: 8 件すべて通った（0.0.7 で `~` の展開の試験を足した）
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

ビルドし直したら（`npm run build`）、動いている Claude Code では `/mcp` で print-craft を再接続する（古いプロセスのまま動き続ける）。

```sh
CLAUDE=~/.vscode/extensions/anthropic.claude-code-2.1.292-darwin-arm64/resources/native-binary/claude
cd ~/pcraft-proto-ws
"$CLAUDE" --plugin-dir ~/Projects/kintone-plugin/print-craft-authoring-mcp/prototype/0-3b
```

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | `/config` で print-craft-proto の「印刷屋プラグインの zip」に zip の絶対パスを入れ、`/mcp` で print-craft を再接続 | `/mcp` に print-craft とツール 2 つ | 2026-10-09 Mac: **期待どおり**（Takashi「1−5 OK」） |
| 2 | 「印刷屋の pcraft_status を呼んで」 | `ready: true`。`registered` に `~/pcraft-proto-ws` の実際のパス（0-3a で登録済み）、`pluginZip.source` が「設定項目」 | 2026-10-09 Mac: **期待どおり**（Takashi「1−5 OK」） |
| 3 | 「temp/sample-見積書.json の中身を、fields/3740.json の項目定義で settings/APP3740-見積書-見積書.json に印刷屋で保存して」 | `ok`。警告（`formula.rawHtml` など）を AI が利用者に伝える。`settings/` にファイルができる。未登録なら登録の確認 → 再接続 → もう一度 | 2026-10-09 Mac: **期待どおり**（Takashi「1−5 OK」） |
| 4 | 同じ依頼をもう一度 | `conflict`（上書きしない） | 2026-10-09 Mac: **期待どおり**（Takashi「1−5 OK」） |
| 5 | 「temp/sample-壊れた.json の中身を settings/壊れた.json に印刷屋で保存して」 | `invalid`（`envelope.pluginID` のエラー）。ファイルはできない | 2026-10-09 Mac: **期待どおり**（Takashi「1−5 OK」） |
| 6 | 「temp/sample-見積書.json の中身を kintone/x.cybozu.com/3740-見積書/新しい帳票.json に印刷屋で保存して」 | `denied`（本番。role: production） | 2026-10-09 Mac: **期待どおり**。`denied`（環境「prod」は本番なので変更できない）。AI は回り道せず、保存先の候補（`settings/`、開発の環境のアプリのフォルダー）を示して利用者に聞いた。ツールの呼び出しのほかにシェルのコマンドを 1 回実行していた（見本の中身を読んだと見られる） |
| 7 | 「settings/直接.json に Write で直接書いて」 | フックが拒否（print-craft MCP の保存のツールを使う） | 2026-10-09 Mac: **期待どおり**。`Write(settings/直接.json)` をフックが拒否（「直接書き換えない。print-craft MCP の保存のツール（pcraft_save_settings / pcraft_update_button）を使う」）。AI は Bash などで回り道せず、`pcraft_save_settings` で保存する案を出して利用者に聞いた。Write の前にシェルのコマンドを 1 回実行していた（中身は未確認） |
| 8 | （任意）`/config` で zip を空にして `/mcp` で再接続 → 3 と同じ依頼（名前を変えて） | `failed`（zip が未設定。設定のしかた）。作業フォルダーの `.env` が無いこと | 2026-10-09: しなかった（Takashi「8 skip」。zip が無いときの failed は自動の試験で確かめた） |

### Desktop（`.mcpb`）

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | `dist-mcpb/print-craft-proto.mcpb` をダブルクリック（または Settings > Extensions）で入れる。入れたら **Desktop を終了して起動し直し、新しいチャット**にする（古いプロセスが動き続けることがある。kSQL の B101） | 0-4 の試作が 0.0.7 に置き換わる。設定項目は「作業フォルダー」と「印刷屋プラグインの zip」だけ | 2026-10-09 Mac: 0.0.7 を入れて Desktop を起動し直したら、0.0.7 が答えた（3 の 2 回目） |
| 2 | 作業フォルダーは**フォルダーを選ぶ画面で** `pcraft-proto-desktop` を選ぶ（手で入れるなら `/Users/<名前>/pcraft-proto-desktop`。0.0.7 から `~/pcraft-proto-desktop` も可）。zip は `print-craft-plugin7.zip` を選ぶ。新しいチャット | | 2026-10-09 Mac: フォルダーを選ぶ画面で `/Users/rex0220/pcraft-proto-desktop` を選んだ（ホームのフォルダーの直下。⌘⇧H か ⌘⇧G で行ける） |
| 3 | 「印刷屋の pcraft_status を呼んで」 | `version` が 0.0.7、`ready: true`、`workspace.path` が作業フォルダー | 2026-10-09 Mac（1 回目）: 答えたのは **0-4 の試作**（`0.0.5-proto`。0-4 にだけある kintone の URL と API トークンの設定が出た）。0.0.6 がまだ入っていないか、古いプロセスが動き続けていた。作業フォルダーに、この表の前の版のとおり `~/pcraft-proto-desktop` を入れたら「絶対パスでない」になった（設定の欄はシェルを通らないので `~` が展開されない）→ 0.0.7 で、先頭の `~/` をホームのフォルダーにした。Node は v24.21.0（0-4 と同じ） ／ （2 回目）: **期待どおり**。版 0.0.7（中核 1.2.0、commit cb9159c）、`ready: true`、作業フォルダー `/Users/rex0220/pcraft-proto-desktop`、zip は設定項目から、Node v24.21.0。AI は「次に帳票の設定を作成しますか」と続けた |
| 4 | `temp/sample-見積書.json` の中身を貼って「印刷屋で、次の設定を settings/APP3740-見積書-見積書.json に保存して（項目定義は fields/3740.json）」 | `ok`。警告を AI が伝える。`~/pcraft-proto-desktop/settings/` にファイルができる（`settings/` は無くても作る） | 2026-10-09 Mac: **期待どおり**。`ok`。AI は情報（PluginVersion 6 の設定を zip の版 7 で検査し、版 7 で書き出した）、警告（`TABLE_HTML` の生の HTML）、大きさ（2,341 バイト、上限の 1%）を伝えた。無かった `settings/` を作って保存（0-3b で直した中核の修正が効いた）。ファイルは版 7、`usedFields` と `formula` あり、一時ファイルとロックは残っていない。AI の説明に「項目定義は fields/3740.json を参照する設定で保存」という不正確な文があった（項目定義は検査に使っただけ） |
| 5 | 同じ依頼をもう一度 | `conflict` | 2026-10-09 Mac（1 回目）: 答えは「同じパスには保存できませんでした（既存のファイルを上書きしない仕様）」と別名・退避の案。**ただしツールを呼んでいない**（Desktop のログで、0.0.7 のプロセスへの tools/call は 13:14 の pcraft_status と 13:17 の 4 の保存だけ）。直前に保存したことから推し量り、試したかのように「保存できませんでした」と伝えた ／ （2 回目。「必ず pcraft_save_settings を呼んで、返った結果をそのまま教えて」）: **期待どおり**。`conflict`（`ConflictError`「同じ名前のファイルがある（新しい設定の保存は上書きしない。直すなら pcraft_update_button）」）。ログに 13:21 の呼び出し。AI は前回が推測だったと自分から認めた。中核の文の `pcraft_update_button` は 0-3b には無い（B1 で足す） |
| 6 | 「同じ内容を ../outside.json に印刷屋で保存して」 | `denied`（作業フォルダーの外） | 2026-10-09 Mac（1 回目）: 答えは「作業フォルダーの外になるパスは、ツールの側で受け付けない設計」と `temp/` などの案。**これもツールを呼んでいない**（ツールの説明の「書ける場所」から推し量った） ／ （2 回目。同じ頼み方）: **期待どおり**。`denied`（`PathError`「書き込み先は作業フォルダーの中: ../outside.json」）。ログに 13:22 の呼び出し |
| 7 | Desktop の `main.log`（`~/Library/Logs/Claude/`） | `[print-craft-mcp] print-craft MCP（試作 0-3b 0.0.7 …）node=v24.… surface=desktop` の行。秘密の値が無い | 2026-10-09 Mac: **期待どおり**。`main.log` に `[UtilityProcess stderr] [print-craft-mcp] print-craft MCP（試作 0-3b 0.0.7。中核 tools 1.2.0、commit cb9159c） node=v24.21.0 surface=desktop workspace=/Users/rex0220/pcraft-proto-desktop pluginZip=設定済み`。起動し直すたびに同じ行。拡張機能のログ（`mcp-server-<表示名>.log`）は手順（method と id）だけで、中身は残らない |

## 手での確認で分かったこと（2026-10-09）

- **Desktop は SDK v2 のサーバーを「modern」と判定した**（拡張機能のログの `Era probe verdict: modern (sibling answered server/discover)`）。0-4 の手書きのサーバーは「legacy」だった。実装案 8.3 のとおり
- **Desktop の AI は、結果を推し量ってツールを呼ばないことがある**（5、6 の 1 回目。「必ず呼んで、返った結果をそのまま」と頼むと呼んだ）。直前に保存した・ツールの説明に書ける場所がある、から答え、5 では試したかのように「保存できませんでした」と伝えた。サーバーは強制の境界だが、呼ばれなければ結果も無い。B1 では、ツールの説明・`instructions`・`pcraft_docs` の目次に「保存できるかを推し量らない。必ずツールを呼び、返った status をそのまま伝える」と書く（状態を「手順の文から推し量らない」と同じ考え。5.2、5.5）。説明に書ける場所を詳しく書くほど、推し量りの材料になる
- **起動の行（標準エラー）は Desktop の `main.log` に `[UtilityProcess stderr]` として残る**。拡張機能のログには手順だけ
- **設定の欄はシェルを通らない**ので `~` が展開されない（0.0.7 で展開するようにした）。README の手順には、選ぶ画面で選ぶか絶対パスを書く
- **拡張機能を入れ直したら Desktop を起動し直す**。0.0.6 を入れたつもりでも、0-4（0.0.5）が答え続けた

