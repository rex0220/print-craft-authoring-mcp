# 段階 0-4 の試作（Claude Desktop の `.mcpb`）

実装案（[../../docs/プラグイン化の実装案.md](../../docs/プラグイン化の実装案.md)）の 9 章 0-4。帳票は作らない。**本物の資格情報は使わない**（試験用の値か、本番でない kintone の閲覧だけの API トークン）。

| ファイル | 中身 |
| --- | --- |
| `server/hello.cjs` | hello の print-craft MCP（依存なし。`--surface desktop`）。ツール `pcraft_docs`、`pcraft_status`、`pcraft_workspace_status`、`kintone_probe`（任意） |
| `build-mcpb.mjs` | `.mcpb` を作る（manifest をここで組み立てる。無圧縮の zip。起動のファイルは `main()` を必ず呼ぶ）。kintone-sql-tools の `build-mcpb.mjs` を元にした |
| `verify-mcpb.mjs` | `.mcpb` の検査（manifest の値、展開して Desktop と同じ形で起動、JSON-RPC で話す、試験用のトークンが漏れない）。kintone-sql-tools の `scripts/mcpb-verify.mjs` を元にした（SDK は使わない） |

作り方と検査:

```sh
cd ~/Projects/kintone-plugin/print-craft-authoring-mcp
node prototype/0-4/build-mcpb.mjs     # → prototype/0-4/dist-mcpb/print-craft-proto.mcpb（git に入れない）
node prototype/0-4/verify-mcpb.mjs
```

## 自動で確かめたこと（2026-10-09。Mac、node v24.14.0）

`verify-mcpb.mjs` が通った:

- manifest: `manifest_version` 0.3、版は semver、`server.type: node`、起動のファイル、**秘密の値は引数でなく `mcp_config.env`**、`workspaceDir` はフォルダーを選ぶ・必須、API トークンは `sensitive`、`pluginZip` はファイルを選ぶ、`platforms` は darwin / win32、`runtimes.node >=20.0.0`
- 起動のファイルは `main()` を必ず呼ぶ
- 起動して: `instructions` の 1 行目に版、ツールの一覧が manifest と同じ、`inputSchema` は `additionalProperties: false`、`pcraft_docs` は文章だけで目次は版の行で始まる、作業フォルダーは起動時に固定・別の `workspaceId` は拒否、cwd は使わない
- 試験用のトークンが env で届き（文字数が合う）、引数・応答（標準出力）・標準エラーに出ない

manifest に `privacy_policies` は入れていない（試作。Desktop がインストールのときに求めるかを手で見る）。

## 手で確かめること（Takashi。Mac、後で Windows）

今の `.mcpb` は 0.0.2（作業フォルダーを作る）。0.0.1 を入れていれば、0.0.2 を入れるのが項目 9（更新）の 1 回目になる。

| # | すること | 期待・見ること | 結果 |
| --- | --- | --- | --- |
| 1 | `dist-mcpb/print-craft-proto.mcpb` をダブルクリック（または Desktop の Settings > Extensions > Advanced settings > Install Extension…） | インストールの画面に「印刷屋 設定オーサリング（試作 0-4）」と設定項目 4 つ。`privacy_policies` が無いことで止まるか・注意が出るか | |
| 2 | 設定項目を入れる: 作業フォルダー = 新しい空のフォルダー（例 `~/pcraft-proto-desktop`）、URL・トークン = 空か試験用、zip = 任意のファイル | フォルダー・ファイルを**選ぶ画面**が出るか。トークンの欄が伏せ字か | |
| 3 | インストールの後、拡張機能の設定画面を開く | **トークンが平文で見えないか**（公開の報告 MCPB issue #244） | |
| 4 | 新しいチャットで「print-craft の pcraft_status を呼んで、結果をそのまま見せて」 | `node`（**Desktop 同梱の Node の版**）、`execPath`、`cwd`、`workspaceDirRaw` / `pluginZipRaw`（**選ぶ画面が返したパスの形**）、`token.set` / `length` / `appearsInArgv: false`（**env で届いたか**。公開の報告 MCPB issue #297） | 2026-10-09 Mac: Node **v24.21.0**（`execPath` は `/Applications/Claude.app/…/Claude Helper (Plugin).app/…`。Desktop のアプリの中のプロセス）。`cwd` は `/`。パスは `/Users/…` の絶対パス。**トークンは env で届いた**（`set: true`、文字数 5 = 試験用の値、引数に無い。`KINTONE_` の環境変数はこれだけ）。接続先は検査を通った。作業フォルダーは「存在しない」（下の気付き） |
| 5 | 新しいチャットで「印刷屋の設定の作り方を教えて」とだけ頼む | AI が自分で `pcraft_docs` を呼ぶか（**instructions と資料のツールを使うか**）。resources を探そうとしないか | |
| 6 | 「pcraft_workspace_status を呼んで」 | 設定のフォルダーが固定されている | |
| 7 | （任意。試験用の kintone があるとき）設定に URL と**閲覧だけの API トークン**を入れ、「kintone_probe を app <番号> で呼んで」 | `app` が 200 か。`pluginConfig`（**pull が使う API ラボの API**）が API トークンで通るか（403 / エラーコードなら API トークンでは使えない → Desktop では `pcraft_pull` を出さない。api-table.md） | |
| 8 | Desktop のログ（`~/Library/Logs/Claude/` の `mcp*.log`）を、試験用のトークンの文字列で検索する | 見つからない | |
| 9 | `server/hello.cjs` の `VERSION` を `0.0.3-proto` に変えて作り直し、もう一度ダブルクリック | 更新できるか。同じ会話のまま `pcraft_status` の版が変わるか（変わらなければ再起動 + 新しい会話で変わるか。kSQL の B101） | |
| 10 | 拡張機能を外す（アンインストール）→ もう一度入れる | 前の設定項目（トークン）が残っているか・消えるか（**値の消し方**） | |
| 11 | Windows の Desktop で 1〜6 と 8〜10 | パスの形（ドライブ文字、`\`）、Node の版、env | |

気付いたこと（関門で決める候補）:

- **「フォルダー」の種類（`type: "directory"`）の設定項目は、存在しないパスも受け付けて、そのままサーバーに渡す**（2026-10-09。設定の欄にパスを入れただけで、フォルダーを作っていなかった）。起動時に確かめる仕組み（実装案 4.1。kSQL は仕様にあったがコードに無かった）が要る裏付け。サーバーは「作業フォルダーが存在しない」と返し、作業フォルダーを使うツールを止めた
- 作業フォルダーは起動時に固定するので、後からフォルダーを作っても拡張機能の入れ直しか Desktop の再起動まで使えなかった
- → **0.0.2 で直した（2026-10-09 Takashi）**: 作業フォルダーが無ければ起動時に作る（絶対パスで、すぐ上のフォルダーが存在するときだけ、最後の 1 段だけ。同じ名前のファイルがあれば使わない）。起動時にだめなら、作業フォルダーを使う呼び出しのたびに同じ設定の値で確かめ直す。`pcraft_status` / `pcraft_workspace_status` に `created` を出す。`verify-mcpb.mjs` で、作る・すぐ上が無いときは作らない・ファイルなら使わない、を確かめた

結果を書いたら、関門（9 章）で 6.1・6.2（秘密の値の渡し方）、5.5（`.mcpb` 1 つで配れるか）、api-table.md の pull の扱いを確定する。

## 後片付け

拡張機能を外し、作業フォルダー（例 `~/pcraft-proto-desktop`）を消す。`dist-mcpb/` と `.tmp/` は git に入らない。
