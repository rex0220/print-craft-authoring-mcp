# 既存の設定を変える（ボタンの追加・修正）

ボタンを足す・丸ごと差し替えるだけなら、既存の設定を使わずに `howto-new` の流れで新しいボタンだけのファイルを作り、設定画面のアップロードの「追加」か「一部置換」で取り込める。既存のボタンの一部を直すときは次の手順。

1. **既存の設定を作業フォルダーに置く** — kintone の API ラボ（プラグインの設定情報を取得する API）を有効にした環境なら `pcraft_pull` で取る。取れなければ、利用者に印刷屋の設定画面の「設定をダウンロード」で保存した JSON（封筒形式）を作業フォルダーの `inbox/` に置いてもらい、`pcraft_take`（行き先の profile を確かめる）でアプリのフォルダーへ移す（接続のファイルが無い作業フォルダーでは `settings/` に置いてもらう）。ダウンロード / pull のファイル（`rex0220-print-craft-app<番号>-<日時>.json`）は書き換えないので、`pcraft_edit` で `-edit.json` に写したものを直す（`settings/` のときは別の名前に写す）
2. **構成を見る** — `pcraft_buttons` でボタンの一覧と `digest`。直すボタンの中身は `button` を付けて見る。設定ファイルそのものは読まない・表示しない（data: の URL などで大きい。ボタンの一覧と中身で足りる）
3. **項目定義が古くないか** — `pcraft_normalize` に `check: true` で、入力の派生値と生成した値が一致するか確かめる（一致しなければ項目定義が古い。`pcraft_fields` で取り直す）
4. **直す** — `pcraft_update_button` に、`pcraft_buttons` が返した `digest` と、ボタン 1 つ（`pluginInfos` の 1 行）の JSON を渡す。`menu` は直すボタンの名前と同じにする（無い名前なら末尾に足す）。ボタンの JSON の形（キー）は雛形（`sample-quote`）で見る。派生値は書かない
   - `conflict`（digest が違う）なら、読んだ後にファイルが変わっている。`pcraft_buttons` で読み直す
5. **preview** — `pcraft_preview`（`button` でそのボタンだけ）。利用者に Chrome で開いてもらう。差は `pcraft_diff`（ダウンロードと `-edit.json`）で利用者に見せる
6. **反映方法を伝える** — `deploy`（既存のボタンの差し替えは「一部置換」）
