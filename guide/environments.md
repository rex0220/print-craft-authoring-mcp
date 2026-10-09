# 開発と本番（作業フォルダーに environments.json があるとき）

`environments.json`（利用者が書く。AI は書かない）に環境（開発 / 本番）とアプリの番号がある。無ければこの章は使わない（今の 1 環境の使い方: `fields/` `records/` `settings/` `out/`）。

- 環境の役割は `role`（`development` / `production`）。本番（`production`）のフォルダーは変えない（新しいダウンロード / pull を足すだけ）。`role` の無い環境のフォルダーは何も変えない。そう断られたら、利用者に `environments.json` へ `role` を書いてもらう
- ツールは `env`（環境の名前。省略は既定の環境）と `app`（番号か `apps` の名前）で使う。保存先は `kintone/<ホスト名>/<番号>-<アプリ名>/` に決まる
- アプリのフォルダー: `fields.json`（`pcraft_fields`）、`records/<番号>.json`（`pcraft_record`）、`out/`（`pcraft_preview`）、設定のダウンロード / pull（`rex0220-print-craft-app<番号>-<日時>.json`。名前はそのまま。一番新しいものが今の設定）、直したもの（`…-edit.json`）、新しい帳票（その他の `*.json`。1 ファイル 1 帳票）
- **ダウンロード / pull のファイルは書き換えない**。直すときは別の名前（`-edit.json`）に写したものを直す
- アプリのフォルダーの中の設定なら、`fields` は要らない（同じフォルダーの `fields.json`）。preview の `record` は番号だけでよい（`3` → `records/3.json`）
- kintone の認証は、その環境の `envFile`（`.env` か `env/<名前>.env`）だけから読む（設定項目の接続先は使わない。開発と本番の取り違えを防ぐ）
- 本番のアプリのフォルダーの設定の preview は、作業フォルダーの `out/` に出る
- **一覧 ID はアプリごとに違う**ので、開発で作るボタンの `viewsCsv` は空（詳細画面とすべての一覧）か `"-"`（詳細画面だけ）にする
