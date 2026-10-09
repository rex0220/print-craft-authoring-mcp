# 新しい設定を作る（print-craft MCP のツールで）

要件は利用者から受け取る（チャットか、作業フォルダーの `requirements/` のファイル）。各ツールの結果は推し量らず、必ず呼んで、返った `status` と `findings` をそのまま利用者に伝える。

1. **準備** — `pcraft_status` で `ready` を確かめる。`ready: false` なら `next` のとおりに利用者に頼む（作業フォルダー、印刷屋の zip の設定）
2. **アプリ番号** — 要件に番号があればそれを使う。無ければ利用者に番号かアプリの URL を聞く（名前で探さない。同名・似た名前のアプリを推測しない）。Desktop では `kintone_get_app` で名前を確かめる
3. **項目** — `pcraft_fields` で項目定義を取る。返った 1 項目 1 行の要約から、要件のラベルを**項目コード**に対応させ、その対応を利用者に示す。計算式と HTML にはラベルでなく項目コードを書く。似たラベル（「合計」「合計金額」など）は推測せず利用者に聞く
4. **レコード** — preview に使う代表の 1 件（明細が複数行、備考に改行、添付あり）を選ぶ。Desktop は `kintone_list_records`（形だけ）、Claude Code は kintone MCP で数件を見て、利用者と決める。`pcraft_record` で保存する（形だけが返る。値は返らない）
5. **帳票** — `pcraft_docs` の `recipes`（帳票レシピ集）の 0 章の既定の形: **HTML テンプレート + `${ESC_HTML(項目)}` + テーブルは `TABLE_HTML`**。CSS は共通 CSS（`css-defaults`）の差分だけ。雛形は `sample-quote`（詳細画面）、`sample-list`（一覧帳票）
6. **保存** — 雛形を写して**封筒形式**で書き、`pcraft_save_settings` で `settings/APP<アプリ番号>-<アプリ名>-<帳票名>.json` に保存する（例 `settings/APP3740-見積書-ご提案書.json`。アプリ名は記号を除いた短い名前。1 ファイルに 1 帳票）。`fields` には手順 3 の項目定義のファイルを渡す
   - 封筒: `pluginID` は `"rex0220 Print craft plugin"`、`PluginVersion` は印刷屋の版（`pcraft_status` の zip の版）、`externalRefs` は `"block"`
   - `filecode`（保存先。空ならダウンロード）、`pageSize`、`orientation`、`dpi`、`printMode` を明示する
   - 派生値（`formula` / `usedFields` / `id` / `views` / `pluginUOG`、更新項目の `type` など）は書かない（保存のときに作られる）
   - `cssInfo`（共通 CSS）は共通 CSS を変えるときだけ書く（帳票の CSS は行の `css` に書く）
   - `invalid` なら `findings` のエラーを直してもう一度（`results` の表）。警告は消さずに利用者に伝える
7. **preview** — `pcraft_preview` で帳票の HTML を `out/` に出す。利用者に Chrome で開いてもらい、印刷屋のプレビューと比べてもらう（近似。画像はダミー）。AI はブラウザーを起動しない。ページ数と式のエラーは結果で確かめる
8. **反映方法を伝える** — `deploy` の手順。確かめてほしい点（見た目、改行、ファイル名、保存先）を添える
