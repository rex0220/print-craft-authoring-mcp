# 画面ごとのツールの表（段階 0-1 ③）

2026-10-09 作成。実装案の 5.1〜5.5 を、ツールごとの約束にした表。承認: Takashi（2026-10-09）。2026-10-10、kintone の接続のファイル（実装案 15 章）に合わせて、`env` / `guestSpaceId` の引数を `profile` に、書く先を `kintone/<profile>/<アプリ>/` に直した。

- **種類**: ① 作業フォルダーを使う（`workspaceId` を持つ。照合と互換表の判定を通す）、② 作業フォルダーを使わない（`workspaceId` を持たない。照合も互換表の判定もしない）、③ 作業フォルダーの診断（`workspaceId` を持ち照合は通す。互換表の判定はしない）
- **出す画面**: 起動の引数 `--surface claude-code | desktop` で決める（プラグインの `.mcp.json` と `.mcpb` の manifest に固定で書く）
- **CLI 相当**: 今の `npx @rex0220/print-craft-authoring-tools …` のどのコマンドの処理を中核から呼ぶか
- 入力は全ツール `additionalProperties: false`。パスはすべて作業フォルダーからの相対で、区切りは `/`（`..`・絶対パス・ドライブ名・`~`・`\`・NUL は denied、`./`・末尾の `/`・`//` は invalid。2026-10-10 Codex の B1 再レビュー MINOR 1）
- 応答は全ツール共通の形（実装案 5.2）。`pcraft_docs` だけ文章
- 読み取りだけのツールには `annotations: { readOnlyHint: true, openWorldHint: false }`

## 1. ツール

| ツール | 種類 | Claude Code | Desktop | 読み取りだけ | 入力 | 返すもの | 書く先 | CLI 相当 | 段階 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pcraft_docs` | ② | 出す | 出す | ○ | `{ section? }` | 引数なし: 目次（1 行目に「この呼び出しに答えたサーバーの版」）。`section`: その章の文章。知らない `section`: 正しい名前の一覧を付けたエラー | — | （資料） | 0-4（相当）、B1 |
| `pcraft_status` | ② | 出す | 出す | ○ | `{}` | サーバーの版、埋め込んだ中核・資料の版、互換表の判定、作業フォルダーの設定、印刷屋の zip、`capabilities`（`authoring`: zip と互換表、`kintone`: 接続のファイルが設定されていて読めるか、ファイルの名前と理由の `code`）、`--surface`。問題があっても `status` は `ok`（`ready: false`） | — | `version --json` | B1 |
| `pcraft_workspace_status` | ③ | 出す | 出す | ○ | `{ workspaceId }` | 登録済みか、動く形（`profiles` / `not-configured` / `legacy-blocked`）、接続のファイル（読めるか、既定の profile、profile ごとの接続先・ゲストスペース・認証の種類・`tokenMap` のアプリとトークンが使えるか、使えない profile と理由、警告。秘密の値と環境変数の名前は返さない）、アプリのフォルダーの名前と印の状態、使われていない profile のフォルダー、`environments.json` が残っていれば「使わない」（無いときは何も返さない。AI が作るものと読み違えたため）、印刷屋の zip（ファイル名、読めるか、互換か、版、`code`。パスは返さない）。接続の誤りがあっても `status` は `ok` | — | （新規） | B1 |
| `pcraft_save_settings` | ① | 出す | 出す | — | `{ workspaceId, path, content, fields?, expectedAbsent: true, profile? }` | `findings`（normalize のエラー・警告・情報）、確定したパス、`digest`、`trustedOrigin`（iframe の接続先のホストか null と理由） | `settings/`、`temp/`、`kintone/<profile>/<アプリ>/`（新しい帳票）。④ | `normalize`（書き戻し） | 0-3b、B1 |
| `pcraft_update_button` | ① | 出す | 出す | — | `{ workspaceId, path, button, expectedDigest, replacement, fields?, profile? }` | `findings`、`digest`、`trustedOrigin` | `settings/`、`kintone/<profile>/<アプリ>/*-edit.json` など。④ | `normalize`（書き戻し） | B1 |
| `pcraft_normalize` | ① | 出す | 出す | ○（`check` / `dryRun` だけ） | `{ workspaceId, path, fields?, check?, profile? }`（常に書き戻さない） | `findings`、`--check` の差、`trustedOrigin` | — | `normalize --dry-run` / `--check` | B1 |
| `pcraft_preview` | ① | 出す | 出す | — | `{ workspaceId, path, fields?, record, button?, profile? }` | 出したファイル、ページ数、式の誤りの場所と件数（誤りの文・ファイル名・HTML はレコードの値を含みうるので返さない）、`trustedOrigin`、`note`。Desktop は結果の `_meta["print-craft/preview"]` に帳票の文書を入れ、ツールの `_meta.ui.resourceUri`（`ui://print-craft/preview.html`）の MCP App が会話の中に表示する（実装案 16 章） | `out/`、`kintone/<profile>/<アプリ>/out/`。④ | `preview` | B1 |
| `pcraft_buttons` | ① | 出す | 出す | ○ | `{ workspaceId, path, button? }` | ボタンの一覧と中身（data: の URL は先頭と長さだけ）、ファイル全体の `digest`、ボタンの識別子（`menu`） | — | `buttons` | B1 |
| `pcraft_fields` | ① | 出す | 出す | — | `{ workspaceId, app, profile?, preview? }`（`app` は番号） | 要約（1 項目 1 行。`fields --summary`。関連レコード一覧の参照先の項目は `親$子`）、`related`（参照先のアプリと項目数。Ver.8）、profile、接続先。取れなかった参照先は `findings`（`fields.related`） | `kintone/<profile>/<アプリ>/fields.json`（フォルダーが無ければ印を置いて作る）。④ | `fields` + `fields --summary` | B1 |
| `pcraft_record` | ① | 出す | 出す | — | `{ workspaceId, app, id, profile?, fieldsFrom? }` | 形の要約だけ（値は返さない。`record --summary`）、`relatedTables`（関連レコード一覧の仮のテーブルの行数。Ver.8。印刷屋の zip が要る） | `kintone/<profile>/<アプリ>/records/`（フォルダーが無ければ「先に `pcraft_fields`」）。④ | `record` + `record --summary` | B1 |
| `kintone_get_app` | ① | **出さない**（公式の kintone MCP） | 出す | ○ | `{ workspaceId, app, profile? }`（番号か URL。URL は profile の接続先とゲストスペースが同じもの。実装案 5.4、15.8） | `appId`、`name`、`code`、`spaceId`、`threadId`、profile（作成者・更新者と説明の全文は返さない） | — | （新規） | B1 |
| `kintone_list_records` | ① | **出さない**（公式の kintone MCP） | 出す | ○ | `{ workspaceId, app, query?, profile? }`（`query` は条件と並べ替えだけ、500 文字まで、`limit` / `offset` を拒否。サーバーが `limit 5` を付ける） | 1 件ごとの形の要約（`$id`、文字数・行数、数値の桁、テーブルの行数、添付の件数と種類）。値・ファイル名・ユーザー名は返さない | — | （新規） | B1 |
| `pcraft_files` | ① | 出す | 出す | ○ | `{ workspaceId, app?, profile? }` | `app` あり: そのアプリのフォルダーのファイル（今の設定、`-edit.json`、新しい帳票、records、out）。`app` なし: profile ごとのアプリのフォルダーの名前と印の状態、使われていない profile のフォルダー、`settings/` `temp/` `fields/` `records/` の JSON、`inbox/` の件数。作業フォルダーは名前だけ | — | `files` | B1 |
| `pcraft_take` | ① | 出す | 出す | — | `{ workspaceId, profile? }` | 移したファイル | `inbox/` から `kintone/<profile>/<アプリ>/`（`inbox/` の元を消す）。④ | `take` | B1 |
| `pcraft_edit` | ① | 出す | 出す | — | `{ workspaceId, app, profile? }` か `{ workspaceId, path }` | 写した `-edit.json` のパス | `kintone/<profile>/<アプリ>/*-edit.json`。④ | `edit` | B1 |
| `pcraft_pull` | ① | 出す | 出す（運用環境だけ） | — | `{ workspaceId, app, profile?, preview? }`（`--force` は受け付けない。Desktop は `preview` を受け付けない） | 保存したファイル、ボタンの一覧、`digest` | `kintone/<profile>/<アプリ>/`（新しいファイル名で増やすだけ。フォルダーが無ければ印を置いて作る）。④ | `pull` | B1 |
| `pcraft_diff` | ① | 出す | 出す | ○ | `{ workspaceId, before, after, derived? }` | ボタン単位の差分 | — | `diff` | B1 |

`pcraft_pull` は kintone の API ラボ（プラグインの設定情報を取得する API）を有効にした環境だけで動く。この API は API トークンで使える API の一覧に載っていないが、**閲覧だけの API トークンで運用環境の設定を取れた**（2026-10-09 試作 0-4）。動作テスト環境（`preview`）はアプリ管理の権限が要るので、Desktop では受け付けない。失敗したら印刷屋の設定画面でダウンロード → `inbox/` → `pcraft_take` を案内する（② api-table.md 3 章）。

## 2. 担当の分け方

| 処理 | Claude Code（`--surface claude-code`） | Desktop（`--surface desktop`） |
| --- | --- | --- |
| アプリを探す | 公式の kintone MCP（パスワード認証のとき名前で探せる） | しない（利用者にアプリの番号か URL をもらう。`apps.json` は API トークンで使えない） |
| アプリの情報を AI に返す | 公式の kintone MCP | `kintone_get_app` |
| レコードを数件見て代表の 1 件を選ぶ | 公式の kintone MCP（値を返す。今のまま） | `kintone_list_records`（形だけ） |
| 項目定義・レコードを作業フォルダーに保存して要約 | `pcraft_fields`、`pcraft_record` | `pcraft_fields`、`pcraft_record` |
| 設定の作成・保存・直し・確認 | `pcraft_save_settings`、`pcraft_update_button`、`pcraft_normalize`、`pcraft_preview`、`pcraft_buttons` | 同じ |
| 手順と資料 | スキル（`print-craft:new` など）と `pcraft_docs` | `pcraft_docs` と `instructions` |
| 制約 | print-craft MCP + フック + `.claude/settings.json` | print-craft MCP だけ |

「両方を出して AI に選ばせる」はしない（同じことをする公式の kintone MCP のツールと print-craft MCP のツールを、同じ画面に出さない）。

## 3. 試作（段階 0）で使うツール

| 段階 | ツール | 確かめること |
| --- | --- | --- |
| 0-3a | 種類 ①②③ を 1 つずつ（例 `pcraft_save_settings` の空の実装、`pcraft_docs`、`pcraft_workspace_status`） | フックが ① と ③ の `workspaceId` を書き換え、② を書き換えないか。書き換えた入力がスキーマを通るか |
| 0-4 | `pcraft_docs` 相当と hello のツール | Desktop のチャットが `instructions` と docs のツールを使うか |
| 0-3b | `pcraft_save_settings`（中核を呼ぶ） | 5.2・5.3 の約束（`conflict`、`denied`、`invalid`、`failed`） |

## 4. 未決

無し。
