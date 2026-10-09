# kintone の接続とアプリのフォルダー（接続のファイル）

kintone への接続は **kintone の接続のファイル**（kSQL の `ksql.config.json` と同じ形。利用者が書いて、print-craft MCP の設定「kintone の接続のファイル」で選ぶ）だけを使う。接続のファイルと、そこが名前を書いた環境変数（`env:` の参照先）は利用者のもの（秘密の値を含む）。**AI は読まない・書かない・表示しない**。状態は `pcraft_workspace_status` で確かめる（profile ごとの接続先、認証の種類、アプリごとのトークンが使えるか。秘密の値と環境変数の名前は返らない）。

- 接続のファイルの `profiles` に、profile ごとの接続先（`baseUrl`）と、アプリごとの API トークン（`tokenMap`）か、ログイン名とパスワードがある。ドメインが違っても、同じドメインでアプリが違ってもよい
- ツールは `profile`（省略すると接続のファイルの `defaultProfile`、無ければ `dev`）と `app`（アプリの番号）で使う。アプリの名前は kintone から取る。ゲストスペースは profile で決まる（1 つの profile は 1 つのスペース）。profile が複数あるときは、どの profile（接続先）のアプリかを利用者に確かめる
- 保存先は **アプリのフォルダー `kintone/<profile>/<番号>-<アプリ名>/`**: `fields.json`（`pcraft_fields`）、`records/<番号>.json`（`pcraft_record`）、`out/`（`pcraft_preview`）、設定のダウンロード / pull（`rex0220-print-craft-app<番号>-<日時>.json`。名前はそのまま。一番新しいものが今の設定）、直したもの（`…-edit.json`）、新しい帳票（その他の `*.json`。1 ファイル 1 帳票）
- アプリのフォルダーを作れるのは `pcraft_fields`、`pcraft_pull`、`pcraft_take` だけ（中に印 `.pcraft-app.json` を置く。消さない・書かない）。`pcraft_record`、`pcraft_edit`、アプリのフォルダーへの保存は、フォルダーが無ければ先に `pcraft_fields`
- 印が今の接続のこのアプリのものでないフォルダー（印が無い・壊れている・profile の接続先を変えた）は使わない（`conflict`）。利用者にフォルダーの名前を変えて退けてもらい、`pcraft_fields` か `pcraft_pull` で作り直す。接続のファイルに無い profile のフォルダーも使わない（`denied`）
- **ダウンロード / pull のファイルは書き換えない**。直すときは `pcraft_edit` で `-edit.json` に写したものを直す
- アプリのフォルダーの中の設定なら、`fields` は要らない（同じフォルダーの `fields.json`）。preview の `record` は番号だけでよい（`3` → `records/3.json`）
- 本番のアプリも同じに扱う（読み取りだけにする守りは無い）。作るのも直すのも開発のアプリにし、本番へは利用者が開発で確かめた同じファイルを本番の設定画面でアップロードする（`deploy`）
- **一覧 ID はアプリごとに違う**ので、開発で作るボタンの `viewsCsv` は空（詳細画面とすべての一覧）か `"-"`（詳細画面だけ）にする
- 接続のファイルが無くても、`settings/` などでの保存・検査・preview は動く（kintone から取るツールだけが使えない）。`environments.json`（tools 1.x の 2 環境の形）は使わない。残っていて接続のファイルが無ければ、kintone のツールとアプリのフォルダーは止まる（利用者に接続のファイルへの移行を頼む）
